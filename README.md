# ennemi-web

The public face of **www.ennemi.net**, served as static files from **ennemi-vps**:

- `/` — "Oups ! Vous n'êtes pas au bon endroit !", the page an audience member lands on when their
  phone reaches the public internet instead of the show's venue network (wrong wifi, VPN, iCloud
  Private Relay). It walks them through turning Private Relay off.
- `/morceau/` — a standalone trailer: a short interactive excerpt of the show, played on a mock phone.

The show app itself (User / Control / Stage) is a separate project, `webapp`, which runs on
ennemi-brain inside the venue network. The two projects share no code.

## Commands

| Command            | Notes                                                             |
| ------------------ | ----------------------------------------------------------------- |
| `make install`     | `npm install` (Node version in `.nvmrc`)                          |
| `make dev`         | Vite dev server on `0.0.0.0:5173`                                 |
| `make build`       | Production build into `dist/`, then gzip + brotli pre-compression |
| `make preview`     | Serve `dist/` on `0.0.0.0:4173`                                   |
| `make quality`     | Lint, format, security, maintainability ([qlty](https://qlty.sh)) |
| `make quality-fix` | Apply the fixes `make quality` can make on its own                |
| `make deploy`      | Build, then rsync `dist/` to `ennemi-vps:/var/www/ennemi-web`     |
| `make clean`       | Remove `dist/`                                                    |

`make quality` needs the qlty CLI: `curl https://qlty.sh | bash`.

## Layout

```text
index.html               landing page (Tailwind v4, compiled at build time)
src/online/              its script and stylesheet
morceau/index.html       the trailer
src/morceau/             its script and stylesheet (plain CSS, no Tailwind)
public/images/           carousel screenshots, served at /images/
public/morceau/video/    trailer clips, .mp4 for Apple WebKit and .webm (with alpha) elsewhere
public/morceau/audio/    the sound-check audio
scripts/                 compress, deploy, quality gate, clip conversion
```

Files under `public/` are copied verbatim to `dist/` at the same path; everything the HTML pulls
from `src/` is bundled into hashed `dist/assets/` files.

`/morceau` (no slash) answers a 308 to `/morceau/`, because relative paths in the page only
resolve under the directory. The Vite dev and preview servers do it with a small plugin in
`vite.config.js`; in production nginx does it.

## Deployment

`make deploy` builds and rsyncs `dist/` to the VPS with `--delete`, running the remote rsync
under `sudo`. Override the target with `VPS_HOST=...` and `VPS_PATH=...`.

**This project owns the content of the web root and nothing else.** The directory itself, the
nginx site serving it, the TLS certificate and its renewal all belong to the `ennemi-metal`
infrastructure repo. The split is what lets the two deploy independently:

| | `ennemi-metal` | `ennemi-web` (here) |
| --- | --- | --- |
| `/var/www/ennemi-web` | creates it, never writes in it | owns everything inside it |
| nginx site, TLS, certbot | owns | — |
| when to run | the architecture changes | the content changes |

So `make deploy` does **not** create the web root: if it is missing, the infrastructure has not
been applied to that host and the script says so rather than deploying a site nothing serves.
It also refuses a `VPS_PATH` of `/`, `/var/www` or anything under `/srv`, because `--delete`
under `sudo` is unforgiving of a typo.

Nothing this script writes can affect the certificate: the ACME HTTP-01 challenge is served
from `/srv/acme`, deliberately outside `/var/www`, so a `--delete` here can never remove a
challenge token mid-renewal.

The nginx sites are `roles/nginx/files/sites/ennemi-web` (port 80 — the ACME challenge, and a
301 to https for everything else) and `roles/nginx/files/sites/ennemi-web-tls` (port 443 — the
site itself) in `ennemi-metal`. The TLS half caches `/assets/` forever, images, video and audio
for a day, and revalidates HTML on every request; it serves the `.br` and `.gz` files this
build writes via `brotli_static`/`gzip_static`.

## Trailer clips

`scripts/convert-morceau-clips.sh` turns green-screen `.mov` masters into VP9/WebM with baked
alpha. The masters are not committed: put them in `public/morceau/video/Clips/` first. It needs
`ffmpeg` and `xxd`.
