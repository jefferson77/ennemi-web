// Plan B: a phone that cannot get onto the venue network still follows the show, through
// ennemi-vps and the tailnet to the show app on ennemi-brain.
//
// POST /api/planb gives it a cookie holding the id of the running spectacle instance, which the
// show app sends with PUT /api/live. nginx on the VPS (ennemi-infra, sites/ennemi-web-tls) asks
// GET /api/planb/check about every request carrying that cookie, and forwards the audience side
// of the show app to brain while it matches. Once it does not -- the show stopped, or another
// one started -- nginx clears the cookie and the phone gets this site again.
import { readCookie } from './cookies.js';

export const PLANB_COOKIE = 'ennemi_planb';

// Longer than any show. The cookie really ends with its instance: this is only a backstop.
export const PLANB_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Whether Plan B is open: a show is running and the show app said which one. An admin switching
 * the site by hand names no instance, so a show started from /admin alone has no Plan B.
 * @param {{live: boolean, instanceId: string|null}} state
 */
export function isPlanBActive(state) {
  return state.live && state.instanceId !== null;
}

/**
 * Whether a Cookie header carries the Plan B cookie of the running instance. The id is no secret
 * (anyone on the tutorial gets it from the button), so a plain comparison is enough.
 * @param {{live: boolean, instanceId: string|null}} state
 * @param {string|undefined} header
 */
export function holdsPlanB(state, header) {
  return isPlanBActive(state) && readCookie(header, PLANB_COOKIE) === state.instanceId;
}

/**
 * The Set-Cookie value giving Plan B for `instanceId`.
 * Path=/ because nginx looks for it on every path, HttpOnly because no page script needs it, and
 * SameSite=Lax so it rides the WebSocket upgrade and a link opened from another app. nginx clears
 * it with the same name and Path, which have to stay in step with this.
 * @param {string} instanceId
 * @param {{secure: boolean, maxAgeMs: number}} options
 */
export function planbCookie(instanceId, { secure, maxAgeMs }) {
  const parts = [`${PLANB_COOKIE}=${instanceId}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
