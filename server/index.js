// Entry point of ennemi-web-api, the one service behind www.ennemi.net: it stores whether a
// show is running, which decides what / shows. Configured entirely from the environment:
//
//   SHOW_TOKEN      secret of the show app (at least 16 characters: a machine sends it)
//   ADMIN_PASSWORD  password of the /admin page (any length, different from the above: a human
//                   types it, and nginx rate-limits the guesses)
//   STATE_DIR       where state.json is kept (default: $STATE_DIRECTORY, set by systemd's
//                   StateDirectory=)
//   HOST, PORT      where to listen (default: 127.0.0.1:8787, only nginx should reach it)
//
// Locally they come from .env (`make api`). On the VPS, `make deploy` copies that same file to
// /opt/ennemi-web-api/.env, which the systemd unit (owned by ennemi-infra) loads.
import { createServer } from 'node:http';
import { createHandler } from './app.js';

const MIN_TOKEN_LENGTH = 16;

function fail(message) {
  console.error(`ennemi-web-api: ${message}`);
  process.exit(1);
}

function secret(name, minLength) {
  const value = process.env[name] ?? '';
  if (value.length < minLength) {
    fail(`${name} must be set in .env (see .env.example), at least ${minLength} character(s)`);
  }
  return value;
}

const showToken = secret('SHOW_TOKEN', MIN_TOKEN_LENGTH);
const adminPassword = secret('ADMIN_PASSWORD', 1);
// The secret that matched is what the state records as its source; one secret for both would
// make that meaningless, and rotating one would lock out the other.
if (showToken === adminPassword) fail('SHOW_TOKEN and ADMIN_PASSWORD must differ');

const stateDir = process.env.STATE_DIR || process.env.STATE_DIRECTORY;
if (!stateDir) fail('STATE_DIR (or systemd StateDirectory=) must be set');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);

const handler = createHandler({ stateDir, showToken, adminPassword, log: (line) => console.log(line) });
const server = createServer(handler);

server.listen(port, host, () => {
  console.log(`listening on http://${host}:${port}, state in ${stateDir}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
