// Reading cookies, for the admin session (session.js) and Plan B (planb.js).

/**
 * The value of cookie `name` in a Cookie header, if any.
 * @param {string|undefined} header
 * @param {string} name
 * @returns {string|null}
 */
export function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
