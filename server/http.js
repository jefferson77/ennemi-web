// What every route of the API answers with, and how it reads a body: shared by app.js and the
// Doomscroll routes (doomscroll.js).

const MAX_BODY_BYTES = 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'expected application/json');
  }
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) throw new HttpError(413, 'body too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export function send(res, status, body) {
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
