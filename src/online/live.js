// Decides what / shows: the connection tutorial while a show is running, the bare "ennemi.net"
// placeholder the rest of the time, and the tutorial's Plan B button while the running show has
// one. The state comes from the API (server/), which the show app and the /admin page switch.
//
// Fails open: if the API cannot be reached, the tutorial is shown. During a show an outage must
// never hide the reconnection help; outside one, showing it by mistake costs nothing. Plan B
// stays hidden then: it needs that same API.

const STATUS_URL = '/api/live';
const TIMEOUT_MS = 2500;
// Short, so a phone already on the page follows the show's Play and Stop within seconds. Longer
// than TIMEOUT_MS, so a slow answer is given up before the next check starts.
const RECHECK_MS = 5_000;

const TUTORIAL_TITLE = document.title;
const PLACEHOLDER_TITLE = 'ennemi.net';

const FAIL_OPEN = Object.freeze({ live: true, planB: false });

async function fetchLive() {
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return FAIL_OPEN;
    const { live, planB } = await response.json();
    return { live: live !== false, planB: planB === true };
  } catch {
    return FAIL_OPEN;
  }
}

function show({ live, planB }) {
  document.getElementById('tutorial').hidden = !live;
  document.getElementById('placeholder').hidden = live;
  document.getElementById('planb').hidden = !planB;
  document.title = live ? TUTORIAL_TITLE : PLACEHOLDER_TITLE;
}

async function refresh() {
  show(await fetchLive());
}

/**
 * Show the right view now, then keep it right: a phone left on the page switches by itself
 * when a show starts or ends, and again as soon as it is brought back to the foreground.
 */
export function startLiveSwitch() {
  refresh();
  setInterval(refresh, RECHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}
