// The "spectacle live" state, persisted as one small JSON file in the state directory.
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const FILE = 'state.json';

// What a fresh host starts with, before anyone has ever toggled it: no show running.
export const INITIAL_STATE = Object.freeze({ live: false, instanceId: null, updatedAt: null, source: null });

// The id of a spectacle instance (one performance, Play to Stop) as the show app sends it: a
// lowercase UUID, the way Postgres prints its uuidv7(). nginx matches the same shape in the Plan B
// cookie (ennemi-infra, conf.d/ennemi-web-planb.conf).
const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `value` is a spectacle instance id. */
export function isInstanceId(value) {
  return typeof value === 'string' && INSTANCE_ID.test(value);
}

/**
 * Read the current state. A missing file is the initial state, not an error.
 * @param {string} dir - The state directory
 * @returns {Promise<{live: boolean, instanceId: string|null, updatedAt: string|null, source: string|null}>}
 */
export async function readState(dir) {
  let raw;
  try {
    raw = await readFile(join(dir, FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ...INITIAL_STATE };
    throw error;
  }
  const parsed = JSON.parse(raw);
  return {
    live: parsed.live === true,
    instanceId: isInstanceId(parsed.instanceId) ? parsed.instanceId : null,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    source: typeof parsed.source === 'string' ? parsed.source : null,
  };
}

/**
 * Replace the state. Written to a temp file, flushed, then renamed over the old one, so a crash
 * or power cut mid-write leaves either the old state or the new one, never half a file.
 * @param {string} dir - The state directory
 * @param {{live: boolean, instanceId: string|null, updatedAt: string, source: string}} state - The new state
 */
export async function writeState(dir, state) {
  await mkdir(dir, { recursive: true });
  const target = join(dir, FILE);
  // Unique per write, so two overlapping writes never share (and truncate) one temp file.
  const temp = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'w', 0o644);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, target);
}

/**
 * The state as one process sees it: read from disk once, then kept in memory, which is safe
 * because the API is the only writer of the file. It matters for Plan B: nginx asks the API about
 * every request a Plan B phone makes.
 * @param {string} dir - The state directory
 */
export function createStateStore(dir) {
  let current = null;
  // Chained, so two overlapping writes land in the order they arrived.
  let writes = Promise.resolve();

  return {
    async get() {
      current ??= await readState(dir);
      return current;
    },

    /** Write `state`, then make it the one `get` answers. */
    async set(state) {
      const next = writes.then(() => writeState(dir, state));
      writes = next.catch(() => {});
      await next;
      current = state;
      return state;
    },
  };
}
