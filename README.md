# ennemi-web

The public face of `www.ennemi.net`, served from **ennemi-vps**: static files, plus one small Node
service that stores whether a show is running.

- `/` — while a show is running, "Oups ! Vous n'êtes pas au bon endroit !", the page an audience
  member lands on when their phone reaches the public internet instead of the show's venue network
  (wrong wifi, VPN, iCloud Private Relay). It walks them through turning Private Relay off, and
  ends on a [Plan B](#plan-b) button for whoever still cannot get on. The rest of the time, just
  "ennemi.net" in white on black.
- `/morceau/` — a standalone trailer: a short interactive excerpt of the show, played on a mock phone.
- `/admin/` — a login form, then a switch to set by hand whether a show is running. Without a
  session nothing but the form is shown.

The show app itself (User / Control / Stage) is a separate project, `webapp`, which runs on
ennemi-brain inside the venue network. The two projects share no code.

## Commands

| Command            | Notes                                                             |
| ------------------ | ----------------------------------------------------------------- |
| `make install`     | `npm install` (Node version in `.nvmrc`)                          |
| `make dev`         | Vite dev server on `0.0.0.0:5173`, proxying `/api` to `make api`  |
| `make api`         | The live-state API on `127.0.0.1:8787`, with dev secrets          |
| `make test`        | The API tests (`node --test`)                                     |
| `make build`       | Production build into `dist/`, then gzip + brotli pre-compression |
| `make preview`     | Serve `dist/` on `0.0.0.0:4173`                                   |
| `make quality`     | Lint, format, security, maintainability ([qlty](https://qlty.sh)) |
| `make quality-fix` | Apply the fixes `make quality` can make on its own                |
| `make deploy`      | Push the API and `dist/` to `ennemi-vps`, restart the API         |
| `make clean`       | Remove `dist/`                                                    |

`make quality` needs the qlty CLI: `curl https://qlty.sh | bash`.

## Layout

```text
index.html               landing page (Tailwind v4, compiled at build time)
src/online/              its scripts and stylesheet; live.js picks the tutorial or the placeholder,
                         planb.js is the Plan B button
morceau/index.html       the trailer
src/morceau/             its script and stylesheet (plain CSS, no Tailwind)
admin/index.html         the live switch
src/admin/               its script and stylesheet (plain CSS, no Tailwind)
server/                  the live-state API: Node 24, no dependencies
public/images/           carousel screenshots, served at /images/
public/morceau/video/    trailer clips, .mp4 for Apple WebKit and .webm (with alpha) elsewhere
public/morceau/audio/    the sound-check audio
scripts/                 compress, deploy, quality gate, clip conversion
```

Files under `public/` are copied verbatim to `dist/` at the same path; everything the HTML pulls
from `src/` is bundled into hashed `dist/assets/` files.

`/morceau` and `/admin` (no slash) answer a 308 to the same path with a slash, because relative paths
in a page only resolve under its directory. The Vite dev and preview servers do it with a small
plugin in `vite.config.js`; in production nginx does it.

## Live state

Whether a show is running decides what `/` shows. It is stored by the API in `server/`, which the
show app switches automatically and `/admin/` switches by hand.

| Request                  | Auth               | Body / answer                                               |
| ------------------------ | ------------------ | ----------------------------------------------------------- |
| `GET /api/live`          | none               | answers `{"live", "planB"}` and nothing more                |
| `PUT /api/live`          | `Bearer` token     | sends `{"live": true, "instanceId"}`, answers the new state |
| `POST /api/planb`        | none               | sets the Plan B cookie, or answers 409                      |
| `GET /api/planb/check`   | the Plan B cookie  | answers 204 if it is the running instance's, else 401       |
| `POST /api/admin/login`  | the password       | sends `{"password"}`, sets the session cookie               |
| `POST /api/admin/logout` | none               | clears the session cookie                                   |
| `GET /api/admin/state`   | the session cookie | answers `{"live", "instanceId", "updatedAt", "source"}`     |
| `PUT /api/admin/live`    | the session cookie | sends `{"live": true}`, answers the new state               |
| `GET /api/healthz`       | none               | answers `ok`                                                |

- `PUT /api/live` is the show app's, with `SHOW_TOKEN`. `/admin/` logs in with `ADMIN_PASSWORD`,
  which is accepted at `/api/admin/login` only — the one place nginx rate-limits guesses.
- `instanceId` is the id of the spectacle instance that is playing (one performance, from Play to
  Stop), a lowercase UUID. It is optional, and recorded only with `"live": true`: a show app that
  sends none still switches the site, it only gets no Plan B. `PUT /api/admin/live` keeps the
  instance the show app named, so switching off and on from `/admin/` mid-show gives Plan B back.
- `source` is `"show"` or `"admin"`, after whichever made the change. Only a logged-in admin sees
  it, and when it happened: the public endpoint says whether a show is running, which `/` shows
  anyway, and nothing else.
- The session is a signed token in an `HttpOnly`, `SameSite=Strict` cookie, valid 12 hours
  (`Secure` on https). It is derived from `ADMIN_PASSWORD` and nothing is stored server-side, so it
  survives a deploy, and **changing the password logs every admin out**.
- A `PUT` is idempotent: sending the same state again is harmless.
- Every answer is `Cache-Control: no-store`. A `PUT` or `POST` with a body needs `Content-Type: application/json` and a
  body under 1 KB.
- The state is one JSON file, written atomically. A fresh host starts with no show running.
- `/` checks the state on load, every 5 s and when the phone brings the page back to the
  foreground. If the API cannot be reached it shows the tutorial: during a show, an outage must
  never hide the reconnection help. It shows the Plan B button only when `planB` is true.

The show app runs on ennemi-brain, where `www.ennemi.net` resolves to brain itself, so it reaches
the VPS over Tailscale instead. nginx on the VPS answers the `ennemi-vps` name to tailnet addresses
only:

```sh
curl -X PUT http://ennemi-vps/api/live \
  -H "Authorization: Bearer $SHOW_TOKEN" -H 'Content-Type: application/json' \
  -d '{"live": true, "instanceId": "0192f3a4-5b6c-7d8e-9f01-23456789abcd"}'
```

### Plan B

For a phone that still reaches this site during a show, however hard its owner tried the tutorial
(a VPN that cannot be turned off, a locked-down phone). The button at the bottom of the tutorial
sends `POST /api/planb`, which answers with a cookie, `ennemi_planb=<instanceId>`, and the page
reloads. From then on nginx on the VPS forwards that phone to the show app on ennemi-brain, over
the tailnet: VPN, then the VPS, then brain.

- nginx asks `GET /api/planb/check` about every request carrying the cookie (`auth_request`). The
  state is kept in memory for that, since the API is its only writer.
- Once the cookie is not the running instance's any more (the show stopped, another one started),
  nginx clears it and redirects to the same address, so the phone gets this site again.
- Only the audience side of the show app is forwarded: `/`, `/_nuxt/`, `/images/`, `/audio/`, the
  socket with `?domain=user` and the video's WHEP offer. Everything else is answered by this site,
  so Control, Stage and brain's monitoring are never reachable through it.
- "Au risque de ne pas avoir certaines fonctionnalités": the live video usually fails, because its
  WebRTC media goes straight between the phone and brain, and nothing relays it.
- The nginx side (`conf.d/ennemi-web-planb.conf` and `sites/ennemi-web-tls`) lives in
  `ennemi-infra`, like the rest of the host. The cookie's name and `Path` appear in both repos.

### Secrets

Both secrets live in `.env` at the root of this repo: git-ignored, with `.env.example` as the
committed template (`cp .env.example .env`). `make api` reads it locally; `make deploy` copies it
to the VPS as `/opt/ennemi-web-api/.env`, root-only, which the systemd unit loads. **To change the
admin password or the show token, edit `.env` and run `make deploy`.** A new password ends every
admin session; a new token needs the show app's copy updated too.

Locally, run `make api` and `make dev` in two terminals.

## Deployment

`make deploy` checks `.env`, runs the tests and builds, then rsyncs `server/` and `.env` to the VPS
and restarts the API, then rsyncs `dist/`. Both syncs use `--delete`, with the remote rsync under
`sudo`. Override the targets with `VPS_HOST=...`, `VPS_PATH=...` and `API_PATH=...`.

**This project owns the content of two directories and nothing else.** The directories
themselves, the nginx sites, the TLS certificate and its renewal, Node, the `ennemi-web-api`
systemd unit and its state directory all belong to the `ennemi-infra` infrastructure repo. The
split is what lets the two deploy independently:

|                                      | `ennemi-infra`                 | `ennemi-web` (here)              |
| ------------------------------------ | ------------------------------ | -------------------------------- |
| `/var/www/ennemi-web`                | creates it, never writes in it | owns everything inside it        |
| `/opt/ennemi-web-api`                | creates it, never writes in it | owns everything inside it        |
| nginx sites, TLS, certbot            | owns                           | —                                |
| Node, the systemd unit and its state | owns                           | pushes `.env`, restarts the unit |
| when to run                          | the architecture changes       | the content changes              |

So `make deploy` does **not** create either directory: if one is missing, the infrastructure has
not been applied to that host and the script says so rather than deploying something nothing
serves. It also refuses a `VPS_PATH` of `/`, `/var/www` or anything under `/srv`, and an
`API_PATH` that is not a directory of its own under `/opt`, because `--delete` under `sudo` is
unforgiving of a typo.

Nothing this script writes can affect the certificate: the ACME HTTP-01 challenge is served
from `/srv/acme`, deliberately outside `/var/www`, so a `--delete` here can never remove a
challenge token mid-renewal.

The nginx sites are in `roles/nginx/files/sites/` in `ennemi-infra`:

- `ennemi-web`: port 80, the ACME challenge, and a 301 to https for everything else.
- `ennemi-web-tls`: port 443, the site itself.
  - It caches `/assets/` forever, images, video and audio for a day, and revalidates HTML on every
    request.
  - It serves the `.br` and `.gz` files this build writes via `brotli_static`/`gzip_static`.
  - It proxies `/api/` to the API on `127.0.0.1:8787`, rate-limiting writes (but not
    `POST /api/planb`, which a crowd behind one carrier address may press at once).
  - It forwards [Plan B](#plan-b) phones to ennemi-brain over the tailnet.
- `ennemi-web-tailnet`: port 80 for the `ennemi-vps` name, to tailnet addresses only. It serves the
  same site and API for the show app on ennemi-brain.

The API runs as `ennemi-web-api.service`: `journalctl -u ennemi-web-api` logs every state change
and every refused write.

## Trailer clips

`scripts/convert-morceau-clips.sh` turns green-screen `.mov` masters into VP9/WebM with baked
alpha. The masters are not committed: put them in `public/morceau/video/Clips/` first. It needs
`ffmpeg` and `xxd`.
