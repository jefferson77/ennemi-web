import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from './app.js';

const SHOW_TOKEN = 'test-show-token-0123456789';
// Two spectacle instance ids, shaped like the show app's uuidv7().
const INSTANCE = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const NEXT_INSTANCE = '0192f3a5-0000-7000-8000-000000000001';
const ADMIN_PASSWORD = 'ennemi';
const TTL_MS = 60_000;

// A clock the tests can move forward, to expire sessions without waiting.
const clock = { now: Date.now() };

async function listen(stateDir, { adminPassword = ADMIN_PASSWORD } = {}) {
  const handler = createHandler({
    stateDir,
    showToken: SHOW_TOKEN,
    adminPassword,
    sessionTtlMs: TTL_MS,
    now: () => clock.now,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function json(body) {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function putShow(base, body, { token = SHOW_TOKEN, type = 'application/json' } = {}) {
  const headers = { 'Content-Type': type };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${base}/api/live`, { method: 'PUT', headers, body: json(body) });
}

function login(base, password, headers = {}) {
  return fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ password }),
  });
}

// The cookie jar, by hand: the name=value part of Set-Cookie, sent back as Cookie.
async function loginCookie(base, password = ADMIN_PASSWORD) {
  const res = await login(base, password);
  assert.equal(res.status, 204);
  return res.headers.get('set-cookie').split(';')[0];
}

function adminState(base, cookie) {
  return fetch(`${base}/api/admin/state`, { headers: cookie ? { Cookie: cookie } : {} });
}

function putAdmin(base, cookie, body, type = 'application/json') {
  const headers = { 'Content-Type': type };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${base}/api/admin/live`, { method: 'PUT', headers, body: json(body) });
}

async function publicState(base) {
  return (await fetch(`${base}/api/live`)).json();
}

function openPlanB(base, headers = {}) {
  return fetch(`${base}/api/planb`, { method: 'POST', headers });
}

function checkPlanB(base, cookie, method = 'GET') {
  return fetch(`${base}/api/planb/check`, { method, headers: cookie ? { Cookie: cookie } : {} });
}

describe('ennemi-web-api', () => {
  let stateDir;
  let server;
  let base;

  before(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'ennemi-web-api-'));
    ({ server, base } = await listen(stateDir));
  });

  after(async () => {
    await close(server);
    await rm(stateDir, { recursive: true, force: true });
  });

  describe('public', () => {
    test('starts not live, with no Plan B, says nothing more, and says not to cache it', async () => {
      const res = await fetch(`${base}/api/live`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await res.json(), { live: false, planB: false });
    });

    test('answers 404 and 405 for anything else', async () => {
      assert.equal((await fetch(`${base}/api/nope`)).status, 404);
      const res = await fetch(`${base}/api/live`, { method: 'DELETE' });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('allow'), 'GET, PUT');
    });

    test('health check', async () => {
      const res = await fetch(`${base}/api/healthz`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'ok\n');
    });
  });

  describe('show app', () => {
    test('the show token switches it on, recorded as "show"', async () => {
      const res = await putShow(base, { live: true });
      assert.equal(res.status, 200);
      const state = await res.json();
      assert.equal(state.live, true);
      assert.equal(state.source, 'show');
      assert.equal(state.instanceId, null);
      assert.ok(Date.parse(state.updatedAt));
      assert.deepEqual(await publicState(base), { live: true, planB: false });
    });

    test('refuses a missing or wrong token, and the admin password', async () => {
      assert.equal((await putShow(base, { live: false }, { token: null })).status, 401);
      assert.equal((await putShow(base, { live: false }, { token: 'not-the-token' })).status, 401);
      assert.equal((await putShow(base, { live: false }, { token: ADMIN_PASSWORD })).status, 401);
      assert.equal((await (await fetch(`${base}/api/live`)).json()).live, true);
    });

    test('refuses a malformed body', async () => {
      assert.equal((await putShow(base, '{live:')).status, 400);
      assert.equal((await putShow(base, { live: 'yes' })).status, 400);
      assert.equal((await putShow(base, {})).status, 400);
      assert.equal((await putShow(base, 'live=true', { type: 'application/x-www-form-urlencoded' })).status, 415);
      assert.equal((await putShow(base, { live: true, pad: 'x'.repeat(2000) })).status, 413);
    });

    test('refuses an instance id that is not a lowercase UUID', async () => {
      assert.equal((await putShow(base, { live: true, instanceId: 'angry-panda' })).status, 400);
      assert.equal((await putShow(base, { live: true, instanceId: INSTANCE.toUpperCase() })).status, 400);
      assert.equal((await putShow(base, { live: true, instanceId: 42 })).status, 400);
      assert.equal((await putShow(base, { live: false, instanceId: 'x' })).status, 400);
    });
  });

  describe('admin', () => {
    test('a wrong password gets no session', async () => {
      const res = await login(base, 'wrong');
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('set-cookie'), null);
      assert.equal((await login(base, 42)).status, 401);
    });

    test('the right password gets an HttpOnly, SameSite=Strict session cookie', async () => {
      const res = await login(base, ADMIN_PASSWORD);
      assert.equal(res.status, 204);
      const cookie = res.headers.get('set-cookie');
      assert.match(cookie, /^ennemi_admin=\d+\.[\w-]+; /);
      assert.match(cookie, /; Path=\/api\/admin/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /; SameSite=Strict/);
      assert.match(cookie, /; Max-Age=60/);
      assert.doesNotMatch(cookie, /Secure/);
    });

    test('the cookie is Secure when the client is on https', async () => {
      const res = await login(base, ADMIN_PASSWORD, { 'X-Forwarded-Proto': 'https' });
      assert.match(res.headers.get('set-cookie'), /; Secure$/);
    });

    test('the full state needs a session', async () => {
      assert.equal((await adminState(base)).status, 401);
      const res = await adminState(base, await loginCookie(base));
      assert.equal(res.status, 200);
      const state = await res.json();
      assert.deepEqual(Object.keys(state).sort(), ['instanceId', 'live', 'source', 'updatedAt']);
    });

    test('a session switches it, recorded as "admin"', async () => {
      const cookie = await loginCookie(base);
      const res = await putAdmin(base, cookie, { live: false });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).source, 'admin');
      assert.equal((await (await adminState(base, cookie)).json()).source, 'admin');
    });

    test('a write without a session, or not as JSON, is refused', async () => {
      assert.equal((await putAdmin(base, null, { live: true })).status, 401);
      const cookie = await loginCookie(base);
      assert.equal((await putAdmin(base, cookie, 'live=true', 'application/x-www-form-urlencoded')).status, 415);
      assert.equal((await putAdmin(base, cookie, { live: 1 })).status, 400);
    });

    test('a tampered or expired session is refused', async () => {
      const cookie = await loginCookie(base);
      const [name, value] = cookie.split('=');
      const [expires, mac] = value.split('.');
      assert.equal((await adminState(base, `${name}=${Number(expires) + 1e9}.${mac}`)).status, 401);
      const flipped = `${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
      assert.equal((await adminState(base, `${name}=${expires}.${flipped}`)).status, 401);
      assert.equal((await adminState(base, `${name}=garbage`)).status, 401);

      clock.now += TTL_MS + 1;
      try {
        assert.equal((await adminState(base, cookie)).status, 401);
      } finally {
        clock.now -= TTL_MS + 1;
      }
    });

    test('changing the password ends every session', async () => {
      const cookie = await loginCookie(base);
      const changed = await listen(stateDir, { adminPassword: 'a-new-password' });
      try {
        assert.equal((await adminState(changed.base, cookie)).status, 401);
      } finally {
        await close(changed.server);
      }
    });

    test('logout clears the cookie', async () => {
      const res = await fetch(`${base}/api/admin/logout`, { method: 'POST' });
      assert.equal(res.status, 204);
      assert.match(res.headers.get('set-cookie'), /^ennemi_admin=; .*Max-Age=0/);
    });
  });

  describe('plan B', () => {
    const cookieOf = (instanceId) => `ennemi_planb=${instanceId}`;

    test('is closed with no show, and with a show that names no instance', async () => {
      await putShow(base, { live: false });
      assert.equal((await openPlanB(base)).status, 409);

      await putShow(base, { live: true });
      assert.deepEqual(await publicState(base), { live: true, planB: false });
      const res = await openPlanB(base);
      assert.equal(res.status, 409);
      assert.equal(res.headers.get('set-cookie'), null);
    });

    test('opens for the instance the show app names, with an HttpOnly, SameSite=Lax cookie on /', async () => {
      const put = await putShow(base, { live: true, instanceId: INSTANCE });
      assert.equal((await put.json()).instanceId, INSTANCE);
      assert.deepEqual(await publicState(base), { live: true, planB: true });

      const res = await openPlanB(base);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const cookie = res.headers.get('set-cookie');
      assert.match(cookie, new RegExp(`^ennemi_planb=${INSTANCE}; `));
      assert.match(cookie, /; Path=\/;/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /; SameSite=Lax/);
      assert.match(cookie, /; Max-Age=43200/);
      assert.doesNotMatch(cookie, /Secure/);
    });

    test('the cookie is Secure when the client is on https', async () => {
      const res = await openPlanB(base, { 'X-Forwarded-Proto': 'https' });
      assert.match(res.headers.get('set-cookie'), /; Secure$/);
    });

    test('the check accepts the running instance only', async () => {
      await putShow(base, { live: true, instanceId: INSTANCE });
      assert.equal((await checkPlanB(base, cookieOf(INSTANCE))).status, 204);
      assert.equal((await checkPlanB(base, `lennemi_uid=abc; ${cookieOf(INSTANCE)}`)).status, 204);
      assert.equal((await checkPlanB(base, cookieOf(INSTANCE), 'HEAD')).status, 204);
      assert.equal((await checkPlanB(base)).status, 401);
      assert.equal((await checkPlanB(base, cookieOf(NEXT_INSTANCE))).status, 401);
      assert.equal((await checkPlanB(base, 'ennemi_planb=')).status, 401);
      assert.equal((await fetch(`${base}/api/planb/check`, { method: 'POST' })).status, 405);
    });

    test('a Stop, or the next Play, ends the cookie', async () => {
      await putShow(base, { live: true, instanceId: INSTANCE });
      await putShow(base, { live: false, instanceId: INSTANCE });
      assert.equal((await checkPlanB(base, cookieOf(INSTANCE))).status, 401);
      assert.equal((await openPlanB(base)).status, 409);

      await putShow(base, { live: true, instanceId: NEXT_INSTANCE });
      assert.equal((await checkPlanB(base, cookieOf(INSTANCE))).status, 401);
      assert.equal((await checkPlanB(base, cookieOf(NEXT_INSTANCE))).status, 204);
    });

    test('an admin switch keeps the instance: off closes Plan B, on opens it again', async () => {
      await putShow(base, { live: true, instanceId: INSTANCE });
      const session = await loginCookie(base);

      await putAdmin(base, session, { live: false });
      assert.deepEqual(await publicState(base), { live: false, planB: false });
      assert.equal((await checkPlanB(base, cookieOf(INSTANCE))).status, 401);

      const res = await putAdmin(base, session, { live: true });
      assert.equal((await res.json()).instanceId, INSTANCE);
      assert.equal((await checkPlanB(base, cookieOf(INSTANCE))).status, 204);
      assert.equal((await (await adminState(base, session)).json()).instanceId, INSTANCE);
    });

    test('the instance survives a restart', async () => {
      await putShow(base, { live: true, instanceId: INSTANCE });
      const restarted = await listen(stateDir);
      try {
        assert.deepEqual(await publicState(restarted.base), { live: true, planB: true });
        assert.equal((await checkPlanB(restarted.base, cookieOf(INSTANCE))).status, 204);
      } finally {
        await close(restarted.server);
      }
    });
  });

  test('the state survives a restart', async () => {
    await putShow(base, { live: true });
    const restarted = await listen(stateDir);
    try {
      assert.deepEqual(await publicState(restarted.base), { live: true, planB: false });
    } finally {
      await close(restarted.server);
    }
  });
});
