// HTTP handler for the "spectacle live" API. Plain (req, res), no framework, so it runs on bare
// node:http and the tests can drive it on an ephemeral port.
//
//   GET  /api/live           public          -> {live}
//   PUT  /api/live           Bearer token    <- {"live": true|false}, -> the new state (the show app)
//   POST /api/admin/login    password        <- {"password": "..."}, sets the session cookie
//   POST /api/admin/logout   none            clears the session cookie
//   GET  /api/admin/state    session cookie  -> {live, updatedAt, source}
//   PUT  /api/admin/live     session cookie  <- {"live": true|false}, -> the new state
//   GET  /api/healthz        public          -> ok
//
// The admin password is accepted at /api/admin/login only, which nginx rate-limits.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readState, writeState } from './state.js';
import { createSessions, readSessionCookie, sessionCookie } from './session.js';

const MAX_BODY_BYTES = 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Hashing first gives both sides the same length, which timingSafeEqual requires, so neither
// the content nor the length of a secret leaks through response timing.
function sameSecret(given, expected) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

async function readJsonBody(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'expected application/json');
  }
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

async function readLive(req) {
  const body = await readJsonBody(req);
  if (typeof body?.live !== 'boolean') throw new HttpError(400, '"live" must be true or false');
  return body.live;
}

function send(res, status, body) {
  const headers = {
    // The state changes at any moment: no browser, proxy or CDN may keep a copy.
    'Cache-Control': 'no-store',
  };
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const json = typeof body !== 'string';
  headers['Content-Type'] = json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
  res.writeHead(status, headers);
  res.end(json ? JSON.stringify(body) : body);
}

function clientAddress(req) {
  // Set by nginx in front; the socket address is only meaningful when running without it.
  return req.headers['x-real-ip'] ?? req.socket.remoteAddress;
}

// nginx says which scheme the client used: https on the public site, http on the tailnet vhost.
function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

/**
 * @param {object} options
 * @param {string} options.stateDir - Where state.json lives
 * @param {string} options.showToken - Secret of the show app, recorded as source "show"
 * @param {string} options.adminPassword - Password of the /admin page, recorded as source "admin"
 * @param {(line: string) => void} [options.log] - One line per state change, login or refusal
 * @param {number} [options.sessionTtlMs] - How long an admin session lasts (default 12 hours)
 * @param {() => number} [options.now] - Current time in ms (injectable for tests)
 */
export function createHandler({
  stateDir,
  showToken,
  adminPassword,
  log = () => {},
  sessionTtlMs = SESSION_TTL_MS,
  now = Date.now,
}) {
  const sessions = createSessions({ password: adminPassword, ttlMs: sessionTtlMs, now });

  function refuse(req, status, message) {
    log(`refused ${req.method} ${req.url} from ${clientAddress(req)}: ${message}`);
    return new HttpError(status, message);
  }

  // Writes are chained so two overlapping PUTs land in the order they arrived.
  let writes = Promise.resolve();
  async function setLive(req, live, source) {
    const state = { live, updatedAt: new Date(now()).toISOString(), source };
    const next = writes.then(() => writeState(stateDir, state));
    writes = next.catch(() => {});
    await next;
    log(`live=${live} by ${source} from ${clientAddress(req)}`);
    return state;
  }

  function requireShowToken(req) {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!match) throw refuse(req, 401, 'missing bearer token');
    if (!sameSecret(match[1], showToken)) throw refuse(req, 401, 'wrong token');
  }

  function requireSession(req) {
    if (!sessions.verify(readSessionCookie(req.headers.cookie))) throw new HttpError(401, 'not logged in');
  }

  async function login(req, res) {
    const body = await readJsonBody(req);
    if (typeof body?.password !== 'string' || !sameSecret(body.password, adminPassword)) {
      throw refuse(req, 401, 'wrong password');
    }
    res.setHeader('Set-Cookie', sessionCookie(sessions.issue(), { secure: isHttps(req), maxAgeMs: sessionTtlMs }));
    log(`admin login from ${clientAddress(req)}`);
    send(res, 204);
  }

  async function logout(req, res) {
    res.setHeader('Set-Cookie', sessionCookie(null, { secure: isHttps(req), maxAgeMs: 0 }));
    log(`admin logout from ${clientAddress(req)}`);
    send(res, 204);
  }

  const routes = {
    '/api/live': {
      // Only the boolean: when and by whom it changed is for logged-in admins.
      GET: async (req, res) => send(res, 200, { live: (await readState(stateDir)).live }),
      PUT: async (req, res) => {
        requireShowToken(req);
        send(res, 200, await setLive(req, await readLive(req), 'show'));
      },
    },
    '/api/admin/login': { POST: login },
    '/api/admin/logout': { POST: logout },
    '/api/admin/state': {
      GET: async (req, res) => {
        requireSession(req);
        send(res, 200, await readState(stateDir));
      },
    },
    '/api/admin/live': {
      PUT: async (req, res) => {
        requireSession(req);
        send(res, 200, await setLive(req, await readLive(req), 'admin'));
      },
    },
    '/api/healthz': {
      GET: async (req, res) => send(res, 200, 'ok\n'),
    },
  };

  return async function handle(req, res) {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const route = routes[pathname];
      if (!route) throw new HttpError(404, 'not found');
      const action = route[req.method];
      if (!action) {
        res.setHeader('Allow', Object.keys(route).join(', '));
        throw new HttpError(405, 'method not allowed');
      }
      await action(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.message });
        return;
      }
      log(`error on ${req.method} ${req.url}: ${error.stack ?? error}`);
      send(res, 500, { error: 'internal error' });
    }
  };
}
