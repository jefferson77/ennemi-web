// The Doomscroll text versions, written from /doomscroll/edition/ and read by the /doomscroll/ phone
// page. Plain files under the state directory, one directory per version and one file per save:
//
//   doomscroll/<id>/2026-10-26T10-32-11.123Z.json   {id, name, savedAt, text, settings}
//   doomscroll/<id>/archived                         present = left out of the list
//
// A save never overwrites anything: the newest file is the version, the older ones are its
// history, and archiving only hides it. Removing one for good is done by hand on the host.
import { mkdir, open, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const DIR = 'doomscroll';
const ARCHIVED = 'archived';

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const MAX_NAME = 80;
export const MAX_TEXT = 200_000;
const MAX_SETTINGS = 40;

/** Whether `value` is a version id, as `create` makes them. */
export function isVersionId(value) {
  return typeof value === 'string' && ID.test(value);
}

// Lowercase ASCII from the name, plus a few random characters so that two versions with the same
// name never share a directory.
function newId(name) {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    .replace(/-+$/, '');
  return `${slug || 'version'}-${randomBytes(3).toString('hex')}`;
}

// File names sort in time order: the ISO date with the colons a file name should not carry.
const fileOf = (savedAt) => `${savedAt.replaceAll(':', '-')}.json`;
const isSave = (name) => name.endsWith('.json');

const isScalar = (v) =>
  (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200);

// Each check answers why a field is refused, or null when it is fine.
const nameError = (name) => (!name || name.length > MAX_NAME ? `"name" must be 1 to ${MAX_NAME} characters` : null);
const textError = (text) =>
  typeof text !== 'string' || text.length > MAX_TEXT
    ? `"text" must be a string of at most ${MAX_TEXT} characters`
    : null;

function settingsError(settings) {
  if (typeof settings !== 'object' || Array.isArray(settings)) return '"settings" must be an object';
  const entries = Object.entries(settings);
  if (entries.length > MAX_SETTINGS) return `"settings" has more than ${MAX_SETTINGS} keys`;
  if (!entries.every(([k, v]) => k.length <= 40 && isScalar(v))) {
    return '"settings" values must be numbers, booleans or short strings';
  }
  return null;
}

/**
 * Check what an editor sends, and keep only that.
 * @returns {{name: string, text: string, settings: Record<string, number|string|boolean>} | string}
 *   The clean record, or why it was refused
 */
export function cleanRecord(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const settings = body?.settings ?? {};
  const error = nameError(name) ?? textError(body?.text) ?? settingsError(settings);
  if (error) return error;
  return { name, text: body.text, settings: Object.fromEntries(Object.entries(settings)) };
}

// A directory's entries, or null when it does not exist.
async function entriesOf(dir, options) {
  try {
    return await readdir(dir, options);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The save files of a version, oldest first, or null when there is no such version.
async function savesOf(root, id) {
  return (await entriesOf(join(root, id)))?.filter(isSave).sort() ?? null;
}

async function latestOf(root, id) {
  const files = await savesOf(root, id);
  if (!files?.length) return null;
  const record = JSON.parse(await readFile(join(root, id, files.at(-1)), 'utf8'));
  return { ...record, saves: files.length };
}

// Temp file, flushed, renamed: a crash mid-write never leaves half a save.
async function writeSave(root, record) {
  const dir = join(root, record.id);
  await mkdir(dir, { recursive: true });
  const target = join(dir, fileOf(record.savedAt));
  const temp = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'w', 0o644);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, target);
}

// The list row of a version, or null when it is archived.
async function rowOf(root, id) {
  if ((await readdir(join(root, id))).includes(ARCHIVED)) return null;
  const record = await latestOf(root, id);
  return record && { id, name: record.name, savedAt: record.savedAt, saves: record.saves };
}

async function listVersions(root) {
  const dirs = (await entriesOf(root, { withFileTypes: true })) ?? [];
  const ids = dirs.filter((e) => e.isDirectory() && isVersionId(e.name)).map((e) => e.name);
  const rows = await Promise.all(ids.map((id) => rowOf(root, id)));
  return rows.filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function saveVersion(root, stamp, id, clean, { base, force = false }) {
  const current = await latestOf(root, id);
  if (!current) return { missing: true };
  if (!force && base !== current.savedAt) return { conflict: current };
  const record = { id, ...clean, savedAt: stamp(current.savedAt) };
  await writeSave(root, record);
  return { saved: { ...record, saves: current.saves + 1 } };
}

async function archiveVersion(root, now, id) {
  if (!(await savesOf(root, id))?.length) return false;
  await writeFile(join(root, id, ARCHIVED), `${new Date(now()).toISOString()}\n`);
  return true;
}

// Runs the tasks it is given one at a time, in the order they came.
function serializer() {
  let queue = Promise.resolve();
  return (task) => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };
}

/**
 * @param {string} stateDir - The API's state directory; versions live in its doomscroll/ subdirectory
 * @param {{now?: () => number}} [options]
 */
export function createVersionStore(stateDir, { now = Date.now } = {}) {
  const root = join(stateDir, DIR);
  // One write at a time, so a save and the conflict check before it cannot interleave with another.
  const serial = serializer();

  // Two saves in the same millisecond would share a file name: the second one waits a tick.
  const stamp = (previous) => new Date(previous ? Math.max(now(), Date.parse(previous) + 1) : now()).toISOString();

  async function create(clean) {
    const record = { id: newId(clean.name), ...clean, savedAt: stamp(null) };
    await writeSave(root, record);
    return { ...record, saves: 1 };
  }

  return {
    /** The versions that are not archived, the most recently saved first, without their text. */
    list: () => listVersions(root),

    /** The newest save of a version, archived or not, or null. */
    get: (id) => (isVersionId(id) ? latestOf(root, id) : Promise.resolve(null)),

    /** A new version. */
    create: (clean) => serial(() => create(clean)),

    /**
     * A new save of an existing version. `base` is the savedAt the editor started from: when
     * someone else has saved since, nothing is written and the newer save comes back as `conflict`.
     * @returns {Promise<{saved: object} | {conflict: object} | {missing: true}>}
     */
    save: (id, clean, options) => serial(() => saveVersion(root, stamp, id, clean, options)),

    /** Hide a version from the list. Its files stay. */
    archive: (id) => serial(() => archiveVersion(root, now, id)),
  };
}
