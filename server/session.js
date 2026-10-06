// Admin sessions for /admin: a stateless signed token in an HttpOnly cookie.
//
// The token is `<expiresAtMs>.<hmac>`, signed with a key derived from ADMIN_PASSWORD. Nothing is
// stored server-side, so sessions survive a restart or a deploy, and changing the password
// invalidates every session at once.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readCookie } from './cookies.js';

export const COOKIE_NAME = 'ennemi_admin';
const COOKIE_PATH = '/api/admin';

/**
 * @param {object} options
 * @param {string} options.password - ADMIN_PASSWORD, which the signing key is derived from
 * @param {number} options.ttlMs - How long a session lasts
 * @param {() => number} options.now - Current time in ms (injectable for tests)
 */
export function createSessions({ password, ttlMs, now }) {
  const key = createHash('sha256').update(`ennemi-web-api session:${password}`).digest();
  const sign = (expires) => createHmac('sha256', key).update(`admin.${expires}`).digest('base64url');

  return {
    ttlMs,

    /** A new session token, valid for ttlMs from now. */
    issue() {
      const expires = now() + ttlMs;
      return `${expires}.${sign(expires)}`;
    },

    /** Whether a token was signed by this password and has not expired. */
    verify(token) {
      const match = /^(\d+)\.([\w-]+)$/.exec(token ?? '');
      if (!match) return false;
      const expires = Number(match[1]);
      const given = Buffer.from(match[2]);
      const expected = Buffer.from(sign(expires));
      return given.length === expected.length && timingSafeEqual(given, expected) && expires > now();
    },
  };
}

/**
 * The session token in a Cookie header, if any.
 * @param {string|undefined} header
 * @returns {string|null}
 */
export function readSessionCookie(header) {
  return readCookie(header, COOKIE_NAME);
}

/**
 * A Set-Cookie value carrying `token`, or clearing the cookie when token is null.
 * HttpOnly so page scripts can never read it; SameSite=Strict so no other site can send it;
 * Secure only when the client is on https (the tailnet vhost and `make dev` are plain http).
 * @param {string|null} token
 * @param {{secure: boolean, maxAgeMs: number}} options
 */
export function sessionCookie(token, { secure, maxAgeMs }) {
  const maxAge = token === null ? 0 : Math.floor(maxAgeMs / 1000);
  const parts = [`${COOKIE_NAME}=${token ?? ''}`, `Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict'];
  parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
