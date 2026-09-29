// /admin: a login form, then the panel that shows and switches whether a show is running.
//
// The password is sent once, to /api/admin/login, which answers with an HttpOnly session cookie;
// the page never keeps the password, and cannot read the cookie. Everything shown on the panel
// comes from /api/admin/state, which needs that session, so a visitor without one sees the login
// form and nothing else.

const LOGIN_URL = '/api/admin/login';
const LOGOUT_URL = '/api/admin/logout';
const STATE_URL = '/api/admin/state';
const LIVE_URL = '/api/admin/live';
const POLL_MS = 10_000;

// The previous version of this page kept the password in localStorage. Erase it from any
// device that still has it.
try {
  localStorage.removeItem('ennemi-admin-password');
} catch {
  // Storage unavailable: nothing was stored there either.
}

const $ = (id) => document.getElementById(id);

let current = null;
let busy = false;
let pollTimer = null;

const SOURCES = { admin: 'depuis cette page', show: 'par le spectacle' };

const ERRORS = {
  401: 'Mot de passe refusé.',
  // nginx's rate limit on writes (ennemi-infra, conf.d/ennemi-web-api.conf).
  429: 'Trop d’essais : patientez une minute.',
  502: 'API injoignable.',
  504: 'API injoignable.',
};

function describe(state) {
  if (!state) return { label: 'État inconnu', meta: 'API injoignable, nouvel essai dans quelques secondes.' };
  const label = state.live ? 'Spectacle en cours' : 'Pas de spectacle';
  if (!state.updatedAt) return { label, meta: 'Jamais modifié.' };
  const when = new Date(state.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
  return { label, meta: `Modifié le ${when} ${SOURCES[state.source] ?? ''}`.trim() };
}

function renderPanel() {
  const { label, meta } = describe(current);
  $('state').dataset.live = current ? String(current.live) : 'unknown';
  $('stateLabel').textContent = label;
  $('stateMeta').textContent = meta;

  const toggle = $('toggle');
  toggle.textContent = current?.live ? 'Arrêter le spectacle' : 'Démarrer le spectacle';
  toggle.disabled = busy || !current;
}

function showLogin(message = '') {
  clearInterval(pollTimer);
  pollTimer = null;
  current = null;
  $('panelView').hidden = true;
  $('loginView').hidden = false;
  $('loginMessage').textContent = message;
  $('password').focus();
}

function showPanel(state) {
  current = state;
  $('loginView').hidden = true;
  $('panelView').hidden = false;
  $('panelMessage').textContent = '';
  renderPanel();
  if (pollTimer === null) pollTimer = setInterval(refresh, POLL_MS);
}

/**
 * Fetch the full state. Resolves to the state, to null when the API cannot be reached, and
 * drops back to the login form when the session is missing or has expired.
 */
async function fetchState() {
  try {
    const response = await fetch(STATE_URL, { cache: 'no-store' });
    if (response.status === 401) return 'logged-out';
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function refresh() {
  const state = await fetchState();
  if (state === 'logged-out') {
    showLogin('Session expirée : reconnectez-vous.');
    return;
  }
  current = state;
  renderPanel();
}

async function login(event) {
  event.preventDefault();
  const input = $('password');
  const button = $('loginButton');
  button.disabled = true;
  try {
    const response = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });
    if (!response.ok) {
      $('loginMessage').textContent = ERRORS[response.status] ?? `Erreur ${response.status}.`;
      input.select();
      return;
    }
    input.value = '';
    const state = await fetchState();
    if (state === 'logged-out') showLogin('Le navigateur a refusé le cookie de session.');
    else showPanel(state);
  } catch {
    $('loginMessage').textContent = 'API injoignable.';
  } finally {
    button.disabled = false;
  }
}

async function toggle() {
  if (!current) return;
  busy = true;
  renderPanel();
  try {
    const response = await fetch(LIVE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ live: !current.live }),
    });
    if (response.status === 401) {
      showLogin('Session expirée : reconnectez-vous.');
      return;
    }
    if (response.ok) {
      current = await response.json();
      $('panelMessage').textContent = '';
    } else {
      $('panelMessage').textContent = ERRORS[response.status] ?? `Erreur ${response.status}.`;
    }
  } catch {
    $('panelMessage').textContent = 'API injoignable.';
  } finally {
    busy = false;
    renderPanel();
  }
}

async function logout() {
  try {
    await fetch(LOGOUT_URL, { method: 'POST' });
  } catch {
    // The cookie then expires by itself; the form is shown either way.
  }
  showLogin();
}

async function init() {
  $('loginView').addEventListener('submit', login);
  $('toggle').addEventListener('click', toggle);
  $('logout').addEventListener('click', logout);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('panelView').hidden) refresh();
  });

  // A session from an earlier visit goes straight to the panel; anything else, the form. An
  // unreachable API shows the form too: the panel would have nothing to show.
  const state = await fetchState();
  if (state && state !== 'logged-out') showPanel(state);
  else showLogin(state === null ? 'API injoignable.' : '');
}

init();
