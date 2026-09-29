#!/bin/bash
# Deploy: push the live-state API to ennemi-vps and restart it, then build the
# site and sync dist/ to the web root.
# Usage: ./scripts/deploy.sh   (or `make deploy`)
#
#   VPS_HOST  ssh destination  (default: ennemi-vps, the host on the tailnet)
#   VPS_PATH  web root         (default: /var/www/ennemi-web, the nginx site's root)
#   API_PATH  API code         (default: /opt/ennemi-web-api, what the unit runs)
#
# The API's secrets come from .env (see .env.example), copied beside the code as
# $API_PATH/.env, which the unit loads. Static files need no reload: nginx
# picks them up. The API is restarted.
#
# This project owns the *content* of those two directories and nothing else.
# The directories themselves, the nginx sites, the TLS certificate, Node and
# the ennemi-web-api systemd unit belong to the ennemi-infra
# repository, which is why this script refuses to create either directory
# rather than quietly making one: a typo'd path would otherwise deploy
# somewhere nothing is serving, and look like it worked.

set -euo pipefail

cd "$(dirname "$0")/.."

VPS_HOST="${VPS_HOST:-ennemi-vps}"
VPS_PATH="${VPS_PATH:-/var/www/ennemi-web}"
API_PATH="${API_PATH:-/opt/ennemi-web-api}"
API_SERVICE=ennemi-web-api
API_HEALTH=http://127.0.0.1:8787/api/healthz

# rsync runs with --delete, under sudo, on the remote side. That combination is
# unforgiving of a wrong path, so refuse the ones that would be catastrophic
# before going anywhere near the network.
case "$VPS_PATH" in
    /var/www | /var/www/ | / | /srv | /srv/* | *..*)
        echo "deploy: refusing to sync to '$VPS_PATH'." >&2
        echo "        --delete there would remove files this project does not own" >&2
        echo "        (/srv/acme holds the ACME challenge the TLS certificate renews with)." >&2
        exit 1
        ;;
esac

# Same reasoning, stricter: the API only ever lives in a directory of its own
# under /opt, so anything else -- /opt itself included -- is a mistake.
case "$API_PATH" in
    *..* | /opt/ | /opt//*)
        API_PATH_OK=false
        ;;
    /opt/?*)
        API_PATH_OK=true
        ;;
    *)
        API_PATH_OK=false
        ;;
esac
if [ "$API_PATH_OK" != true ]; then
    echo "deploy: refusing to sync the API to '$API_PATH'." >&2
    echo "        It must be a directory of its own under /opt (default /opt/ennemi-web-api)." >&2
    exit 1
fi

# Checked here, before the network: a deploy that would restart the API with a
# missing secret should fail now, not leave the service crash-looping.
for key in ADMIN_PASSWORD SHOW_TOKEN; do
    if ! grep -qE "^$key=.+" .env 2>/dev/null; then
        echo "deploy: .env has no $key. Copy .env.example to .env and fill it in." >&2
        exit 1
    fi
done

echo "=========================================="
echo "Deploying ennemi-web to $VPS_HOST"
echo "  site: $VPS_PATH"
echo "  api:  $API_PATH"
echo "=========================================="

echo ""
echo "Step 1/4: Checking the target..."
echo "----------------------------------------"
# Before the build, not after: a wrong host or an unprepared one should cost a
# second, not a full compile.
#
# Both directories are created by the ennemi-infra repo (nginx_webroots in
# inventory/host_vars/ennemi-vps.yml, and roles/ennemi_web_api), not here.
# Check rather than create, so a host that has never had the infrastructure
# applied says so plainly instead of receiving files nothing is set up to use.
for dir in "$VPS_PATH" "$API_PATH"; do
    # shellcheck disable=SC2029 # dir is meant to expand locally
    if ! ssh "$VPS_HOST" "test -d '$dir'"; then
        echo "deploy: $VPS_HOST has no $dir." >&2
        echo "        That directory, and the nginx site, certificate or service" >&2
        echo "        using it, belong to the ennemi-infra repo. Apply it there first:" >&2
        echo "            ./deploy ennemi-vps --tags=nginx,certbot,nodejs,ennemi_web_api" >&2
        exit 1
    fi
done
echo "$VPS_HOST:$VPS_PATH and $VPS_HOST:$API_PATH are ready."

echo ""
echo "Step 2/4: Testing and building..."
echo "----------------------------------------"
npm test
npm run build

echo ""
echo "Step 3/4: Syncing server/ to the VPS and restarting the API..."
echo "----------------------------------------"
# Before the site, so the pages that call the API find the version they expect.
# The directory is root-owned on the remote side, like the web root, so rsync
# runs under sudo. The tests stay here: the VPS only runs the service. .env is
# excluded so --delete leaves it alone; it goes separately, readable by root
# only (systemd reads it before starting the service).
rsync -az --delete --info=stats1 --rsync-path="sudo rsync" --chmod=D755,F644 \
    --exclude='*.test.js' --exclude='/.env' server/ "$VPS_HOST:$API_PATH/"
rsync -z --perms --chmod=F600 --no-owner --no-group --rsync-path="sudo rsync" \
    .env "$VPS_HOST:$API_PATH/.env"
# The retries cover the second or so between the restart and the port opening.
# shellcheck disable=SC2029 # the names are meant to expand locally
ssh "$VPS_HOST" "sudo systemctl restart $API_SERVICE \
    && curl -fsS --retry 5 --retry-connrefused --retry-delay 1 $API_HEALTH"

echo ""
echo "Step 4/4: Syncing dist/ to the VPS..."
echo "----------------------------------------"
# The web root is written by root on the remote side, so rsync runs under sudo.
rsync -az --delete --info=stats1 --rsync-path="sudo rsync" --chmod=D755,F644 dist/ "$VPS_HOST:$VPS_PATH/"

echo ""
echo "✓ Deployed."
