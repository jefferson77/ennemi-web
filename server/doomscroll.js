// The Doomscroll routes, listed with the others at the top of app.js: the text versions of
// /doomscroll/ (see versions.js), read by anyone with the link, written with the /admin session.
// Their write routes sit under /api/admin/, where its cookie goes.
import { HttpError, readJsonBody, send } from './http.js';
import { cleanRecord, isVersionId } from './versions.js';

// A Doomscroll version carries a whole text: a few kilobytes, room left for long ones.
const MAX_VERSION_BYTES = 256 * 1024;

/**
 * @param {{versions: ReturnType<typeof import('./versions.js').createVersionStore>,
 *   requireSession: (req: object) => void, log: (line: string) => void}} deps
 */
export function doomscrollRoutes({ versions, requireSession, log }) {
  async function list(req, res) {
    send(res, 200, { versions: await versions.list() });
  }

  async function get(req, res) {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const record = isVersionId(id) ? await versions.get(id) : null;
    if (!record) throw new HttpError(404, 'no such version');
    send(res, 200, record);
  }

  async function create(res, clean) {
    const record = await versions.create(clean);
    log(`doomscroll version ${record.id} created`);
    send(res, 201, record);
  }

  // Refused with 409 and the newer save when someone saved since `base`, unless `force` says to
  // save over it anyway.
  async function update(res, body, clean) {
    if (!isVersionId(body.id)) throw new HttpError(400, '"id" is not a version id');
    const result = await versions.save(body.id, clean, { base: body.base ?? null, force: body.force === true });
    if (result.missing) throw new HttpError(404, 'no such version');
    if (result.conflict) {
      const { id, name, savedAt, saves } = result.conflict;
      send(res, 409, { error: 'saved by someone else since', latest: { id, name, savedAt, saves } });
      return;
    }
    log(`doomscroll version ${body.id} saved (${result.saved.saves})`);
    send(res, 200, result.saved);
  }

  // No id: a new version. An id: a new save of it.
  async function save(req, res) {
    requireSession(req);
    const body = await readJsonBody(req, MAX_VERSION_BYTES);
    const clean = cleanRecord(body);
    if (typeof clean === 'string') throw new HttpError(400, clean);
    await (body.id == null ? create(res, clean) : update(res, body, clean));
  }

  async function archive(req, res) {
    requireSession(req);
    const { id } = (await readJsonBody(req)) ?? {};
    if (!isVersionId(id) || !(await versions.archive(id))) throw new HttpError(404, 'no such version');
    log(`doomscroll version ${id} archived`);
    send(res, 204);
  }

  return {
    '/api/doomscroll/versions': { GET: list },
    '/api/doomscroll/version': { GET: get },
    '/api/admin/doomscroll/version': { PUT: save },
    '/api/admin/doomscroll/archive': { POST: archive },
  };
}
