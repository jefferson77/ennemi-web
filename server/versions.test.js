import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from './app.js';

const ADMIN_PASSWORD = 'ennemi';
// A clock the tests move by hand, so two saves never land on the same millisecond by chance.
const clock = { now: Date.parse('2026-10-26T10:00:00.000Z') };

async function listen(stateDir) {
  const handler = createHandler({
    stateDir,
    showToken: 'test-show-token-0123456789',
    adminPassword: ADMIN_PASSWORD,
    now: () => clock.now,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const close = (server) => new Promise((resolve) => server.close(resolve));

const TEXT = 'Culbute d’un chat\n@0:00 Guilleret\n++ Deux loutres\n+ Un hérisson\n@1:60 Fin';
const SETTINGS = { forfait: 0.5, perChar: 0.025, ink: true };

describe('doomscroll versions', () => {
  let stateDir;
  let server;
  let base;
  let cookie;

  const put = (body, { session = cookie } = {}) =>
    fetch(`${base}/api/admin/doomscroll/version`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) },
      body: JSON.stringify(body),
    });
  const list = async () => (await (await fetch(`${base}/api/doomscroll/versions`)).json()).versions;
  const get = (id) => fetch(`${base}/api/doomscroll/version?id=${encodeURIComponent(id)}`);
  const archive = (id, session = cookie) =>
    fetch(`${base}/api/admin/doomscroll/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) },
      body: JSON.stringify({ id }),
    });

  before(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'ennemi-web-versions-'));
    ({ server, base } = await listen(stateDir));
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    cookie = res.headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    await close(server);
    await rm(stateDir, { recursive: true, force: true });
  });

  test('starts with no versions', async () => {
    assert.deepEqual(await list(), []);
    assert.equal((await get('nothing-here')).status, 404);
  });

  test('writing needs the admin session; reading does not', async () => {
    const res = await put({ name: 'Essai', text: TEXT }, { session: null });
    assert.equal(res.status, 401);
    assert.equal((await archive('essai-000000', null)).status, 401);
    assert.deepEqual(await list(), []);
  });

  test('creates, reads back, saves again, and keeps every save', async () => {
    clock.now += 1000;
    const created = await put({ name: 'Uccle, été indien', text: TEXT, settings: SETTINGS });
    assert.equal(created.status, 201);
    const v1 = await created.json();
    assert.match(v1.id, /^uccle-ete-indien-[0-9a-f]{6}$/);
    assert.equal(v1.saves, 1);

    const read = await (await get(v1.id)).json();
    assert.deepEqual(read, { ...v1 });
    assert.equal(read.text, TEXT);
    assert.deepEqual(read.settings, SETTINGS);

    clock.now += 1000;
    const res = await put({ id: v1.id, base: v1.savedAt, name: v1.name, text: `${TEXT}\n+ Encore` });
    assert.equal(res.status, 200);
    const v2 = await res.json();
    assert.equal(v2.saves, 2);
    assert.ok(v2.savedAt > v1.savedAt);
    assert.equal((await (await get(v1.id)).json()).text, `${TEXT}\n+ Encore`);
    assert.equal((await readdir(join(stateDir, 'doomscroll', v1.id))).length, 2);

    const [row] = (await list()).filter((v) => v.id === v1.id);
    assert.deepEqual(row, { id: v1.id, name: v1.name, savedAt: v2.savedAt, saves: 2 });
  });

  test('a save over someone else’s newer save is refused, unless forced', async () => {
    clock.now += 1000;
    const v1 = await (await put({ name: 'Conflit', text: 'a' })).json();
    clock.now += 1000;
    await put({ id: v1.id, base: v1.savedAt, name: 'Conflit', text: 'b' });

    clock.now += 1000;
    const stale = await put({ id: v1.id, base: v1.savedAt, name: 'Conflit', text: 'c' });
    assert.equal(stale.status, 409);
    const { latest } = await stale.json();
    assert.equal(latest.saves, 2);
    assert.equal(latest.text, undefined);
    assert.equal((await (await get(v1.id)).json()).text, 'b');

    const forced = await put({ id: v1.id, base: v1.savedAt, force: true, name: 'Conflit', text: 'c' });
    assert.equal(forced.status, 200);
    assert.equal((await (await get(v1.id)).json()).text, 'c');
  });

  test('archiving hides a version from the list and keeps its files', async () => {
    clock.now += 1000;
    const v = await (await put({ name: 'À ranger', text: 'x' })).json();
    assert.ok((await list()).some((r) => r.id === v.id));
    assert.equal((await archive(v.id)).status, 204);
    assert.ok(!(await list()).some((r) => r.id === v.id));
    assert.equal((await get(v.id)).status, 200);
    assert.equal((await archive('never-made-000000')).status, 404);
  });

  test('the newest save comes first in the list', async () => {
    const names = (await list()).map((v) => v.name);
    assert.deepEqual(names, ['Conflit', 'Uccle, été indien']);
  });

  test('refuses what is not a version', async () => {
    assert.equal((await put({ name: '', text: TEXT })).status, 400);
    assert.equal((await put({ name: 'x'.repeat(81), text: TEXT })).status, 400);
    assert.equal((await put({ name: 'Sans texte' })).status, 400);
    assert.equal((await put({ name: 'Réglages', text: '', settings: { nested: { a: 1 } } })).status, 400);
    assert.equal((await put({ id: '../../etc', name: 'Chemin', text: '' })).status, 400);
    assert.equal((await put({ id: 'jamais-vue-000000', name: 'Inconnue', text: '' })).status, 404);
    assert.equal((await get('../state')).status, 404);
  });

  test('takes a long text, but not an endless one', async () => {
    clock.now += 1000;
    const long = 'Un post assez long pour peser son poids de lecture\n'.repeat(1500);
    assert.equal((await put({ name: 'Longue', text: long })).status, 201);
    assert.equal((await put({ name: 'Trop longue', text: 'x'.repeat(300_000) })).status, 413);
  });

  test('the versions survive a restart', async () => {
    const before = await list();
    const restarted = await listen(stateDir);
    try {
      const res = await fetch(`${restarted.base}/api/doomscroll/versions`);
      assert.deepEqual((await res.json()).versions, before);
    } finally {
      await close(restarted.server);
    }
  });
});
