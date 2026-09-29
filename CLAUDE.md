# CLAUDE.md

Guidance for Claude Code when working in this repository. See `README.md` for what the site is,
the commands, the layout and deployment.

## Ground rules

- **Independent of `webapp`.** This project must never import, link or fetch anything from the
  show app (`../webapp`), and must not assume it is running. If something from there is needed,
  copy it here.
- **Static only.** Vite multi-page build, vanilla JS modules, no framework, no server code.
  Every page is an entry in `build.rollupOptions.input` in `vite.config.js`.
- **Tailwind only on the landing page.** `src/morceau/styles.css` is plain CSS on purpose:
  Tailwind's preflight reset would restyle the phone frame.
- **Absolute paths for public files.** `public/` is served from `/`, so reference its files as
  `/images/…` or `/morceau/video/…`, never relative.
- **Use npm.** `package-lock.json` is committed.

## Code quality

Run `make quality` after every change, and fix every finding in the files you touched. Never
silence a finding with an inline suppression; if one really is a false positive, add a scoped
exclusion in `.qlty/qlty.toml`. **Never use `qlty check --fix`**: `make quality-fix` runs
eslint's own `--fix`, then formats. Prettier owns formatting (eslint-config-prettier comes last).

`.editorconfig` is authoritative: 2-space indent and 120 columns, except `*.sh` at 4 spaces.

## Deploying

`make deploy` writes to the production VPS. Run it only when asked.

- **Content only.** This repo owns the contents of `/var/www/ennemi-web` and nothing else on
  that host. The directory, the nginx site, the TLS certificate and its renewal belong to the
  `ennemi-metal` repo. Never add nginx config, certificate handling or host setup here — change
  it there instead, so the two deploys stay independent.
- `scripts/deploy.sh` deliberately does not create the web root and refuses a dangerous
  `VPS_PATH`. Do not "fix" either: both exist because the remote rsync runs `--delete` under
  `sudo`.
