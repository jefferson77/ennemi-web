// The tutorial's Plan B button, for whoever still cannot get onto the venue network.
//
// POST /api/planb answers with a cookie naming the running performance. Reloading the page then
// has nginx on this server forward the phone to the show app on ennemi-brain, over the tailnet
// (ennemi-infra, sites/ennemi-web-tls), for as long as that performance runs. The API refuses
// with 409 when the show has no Plan B.

const PLANB_URL = '/api/planb';
const TIMEOUT_MS = 5_000;

const UNAVAILABLE = "Le plan B n'est pas disponible pour le moment.";
const UNREACHABLE = 'Impossible de joindre le serveur, réessayez.';

/** The answer's status, or null if there was none. */
async function requestPlanB() {
  try {
    const response = await fetch(PLANB_URL, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.status;
  } catch {
    return null;
  }
}

/** Wire the button. It stays disabled from the click until the page reloads or the API says no. */
export function startPlanB() {
  const button = document.getElementById('planbButton');
  const message = document.getElementById('planbMessage');

  button.addEventListener('click', async () => {
    button.disabled = true;
    message.textContent = '';
    const status = await requestPlanB();
    if (status === 204) {
      // The cookie is set: the same address now leads to the show app.
      location.reload();
      return;
    }
    message.textContent = status === 409 ? UNAVAILABLE : UNREACHABLE;
    button.disabled = false;
  });
}
