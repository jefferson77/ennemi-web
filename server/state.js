// The "spectacle live" state, persisted as one small JSON file in the state directory.
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const FILE = 'state.json';

// What a fresh host starts with, before anyone has ever toggled it: no show running.
export const INITIAL_STATE = Object.freeze({ live: false, updatedAt: null, source: null });

/**
 * Read the current state. A missing file is the initial state, not an error.
 * @param {string} dir - The state directory
 * @returns {Promise<{live: boolean, updatedAt: string|null, source: string|null}>}
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
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    source: typeof parsed.source === 'string' ? parsed.source : null,
  };
}

/**
 * Replace the state. Written to a temp file, flushed, then renamed over the old one, so a crash
 * or power cut mid-write leaves either the old state or the new one, never half a file.
 * @param {string} dir - The state directory
 * @param {{live: boolean, updatedAt: string, source: string}} state - The new state
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
