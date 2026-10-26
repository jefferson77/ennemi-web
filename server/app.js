// HTTP handler for the "spectacle live" API. Plain (req, res), no framework, so it runs on bare
// node:http and the tests can drive it on an ephemeral port.
//
//   GET  /api/live           public          -> {live, planB}
//   PUT  /api/live           Bearer token    <- {"live": true|false, "instanceId"?: uuid}, -> the new
//                                               state (the show app)
//   POST /api/planb          public          sets the Plan B cookie, or 409 when there is no Plan B
//   GET  /api/planb/check    Plan B cookie   204 if it is the running instance's, else 401 (nginx)
//   POST /api/admin/login    password        <- {"password": "..."}, sets the session cookie
//   POST /api/admin/logout   none            clears the session cookie
//   GET  /api/admin/state    session cookie  -> {live, instanceId, updatedAt, source}
//   PUT  /api/admin/live     session cookie  <- {"live": true|false}, -> the new state
//   GET  /api/healthz        public          -> ok
//
//   GET  /api/doomscroll/versions          public          -> {versions: [{id, name, savedAt, saves}]}
//   GET  /api/doomscroll/version?id=...    public          -> {id, name, savedAt, saves, text, settings}
//   PUT  /api/admin/doomscroll/version     session cookie  <- {id?, base?, force?, name, text, settings}
//   POST /api/admin/doomscroll/archive     session cookie  <- {"id": "..."}
//
// The Doomscroll routes store the text versions of /doomscroll/ (see doomscroll.js and versions.js).
// Writing them takes the /admin password, so their write routes sit under /api/admin/, where its
// cookie goes.
//
// The admin password is accepted at /api/admin/login only, which nginx rate-limits. Plan B is
// described in planb.js.
import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, readJsonBody, send } from './http.js';
import { createStateStore, isInstanceId } from './state.js';
import { createSessions, readSessionCookie, sessionCookie } from './session.js';
import { PLANB_TTL_MS, holdsPlanB, isPlanBActive, planbCookie } from './planb.js';
import { createVersionStore } from './versions.js';
import { doomscrollRoutes } from './doomscroll.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Hashing first gives both sides the same length, which timingSafeEqual requires, so neither
// the content nor the length of a secret leaks through response timing.
function sameSecret(given, expected) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

async function readLive(req) {
  const body = await readJsonBody(req);
  if (typeof body?.live !== 'boolean') throw new HttpError(400, '"live" must be true or false');
  return body;
}

// The show app also says which spectacle instance is playing, which Plan B is keyed on. Optional,
// so a show app that predates Plan B still switches the site, only without a Plan B. A show that
// stops has no instance, whatever was sent.
function readInstanceId(body) {
  const instanceId = body.instanceId ?? null;
  if (instanceId !== null && !isInstanceId(instanceId)) {
    throw new HttpError(400, '"instanceId" must be a lowercase UUID');
  }
  return body.live ? instanceId : null;
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
 * The Plan B routes (see planb.js): the tutorial's button, and the check nginx makes.
 * @param {{store: ReturnType<typeof createStateStore>, log: (line: string) => void}} deps
 */
function planBRoutes({ store, log }) {
  async function open(req, res) {
    const state = await store.get();
    if (!isPlanBActive(state)) throw new HttpError(409, 'no Plan B right now');
    res.setHeader('Set-Cookie', planbCookie(state.instanceId, { secure: isHttps(req), maxAgeMs: PLANB_TTL_MS }));
    log(`plan B for ${state.instanceId} from ${clientAddress(req)}`);
    send(res, 204);
  }

  // nginx's auth_request, on every request of a Plan B phone: a bare status, and no log line.
  async function check(req, res) {
    send(res, holdsPlanB(await store.get(), req.headers.cookie) ? 204 : 401);
  }

  return {
    '/api/planb': { POST: open },
    '/api/planb/check': { GET: check, HEAD: check },
  };
}

/**
 * @param {object} options
 * @param {string} options.stateDir - Where state.json and the Doomscroll versions live
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
  const store = createStateStore(stateDir);
  const versions = createVersionStore(stateDir, { now });

  function refuse(req, status, message) {
    log(`refused ${req.method} ${req.url} from ${clientAddress(req)}: ${message}`);
    return new HttpError(status, message);
  }

  async function setLive(req, { live, instanceId }, source) {
    const state = await store.set({ live, instanceId, updatedAt: new Date(now()).toISOString(), source });
    const instance = instanceId ? ` (instance ${instanceId})` : '';
    log(`live=${live}${instance} by ${source} from ${clientAddress(req)}`);
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
      // Whether a show is running and whether it has a Plan B: when and by whom it changed is
      // for logged-in admins.
      GET: async (req, res) => {
        const state = await store.get();
        send(res, 200, { live: state.live, planB: isPlanBActive(state) });
      },
      PUT: async (req, res) => {
        requireShowToken(req);
        const body = await readLive(req);
        send(res, 200, await setLive(req, { live: body.live, instanceId: readInstanceId(body) }, 'show'));
      },
    },
    ...planBRoutes({ store, log }),
    '/api/admin/login': { POST: login },
    '/api/admin/logout': { POST: logout },
    '/api/admin/state': {
      GET: async (req, res) => {
        requireSession(req);
        send(res, 200, await store.get());
      },
    },
    '/api/admin/live': {
      // The admin names no instance and keeps the show app's: switching off and on again in the
      // middle of a show gives its Plan B back.
      PUT: async (req, res) => {
        requireSession(req);
        const { live } = await readLive(req);
        const { instanceId } = await store.get();
        send(res, 200, await setLive(req, { live, instanceId }, 'admin'));
      },
    },
    '/api/healthz': {
      GET: async (req, res) => send(res, 200, 'ok\n'),
    },
    ...doomscrollRoutes({ versions, requireSession, log }),
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
