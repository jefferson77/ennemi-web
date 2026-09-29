#!/bin/bash
# Deploy: build the site, then sync dist/ to the web root on ennemi-vps.
# Usage: ./scripts/deploy.sh   (or `make deploy`)
#
#   VPS_HOST  ssh destination  (default: ennemi-vps, the host on the tailnet)
#   VPS_PATH  web root         (default: /var/www/ennemi-web, the nginx site's root)
#
# Static files only: nginx picks them up without a reload.
#
# This project owns the *content* of that directory and nothing else. The
# directory itself, the nginx site that serves it and its TLS certificate belong
# to the ennemi-metal infrastructure repository, which is why this script
# refuses to create the web root rather than quietly making one: a typo'd
# VPS_PATH would otherwise deploy the site somewhere nothing is serving, and
# look like it worked.

set -euo pipefail

cd "$(dirname "$0")/.."

VPS_HOST="${VPS_HOST:-ennemi-vps}"
VPS_PATH="${VPS_PATH:-/var/www/ennemi-web}"

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

echo "=========================================="
echo "Deploying ennemi-web to $VPS_HOST:$VPS_PATH"
echo "=========================================="

echo ""
echo "Step 1/3: Checking the target..."
echo "----------------------------------------"
# Before the build, not after: a wrong host or an unprepared one should cost a
# second, not a full compile.
#
# The web root is created by the ennemi-metal repo (nginx_webroots in
# inventory/host_vars/ennemi-vps.yml), not here. Check rather than create, so a
# host that has never had the infrastructure applied says so plainly instead of
# receiving a site no nginx is configured to serve.
# shellcheck disable=SC2029 # VPS_PATH is meant to expand locally
if ! ssh "$VPS_HOST" "test -d '$VPS_PATH'"; then
    echo "deploy: $VPS_HOST has no $VPS_PATH." >&2
    echo "        That directory, the nginx site serving it and its certificate" >&2
    echo "        belong to the ennemi-metal repo. Apply it there first:" >&2
    echo "            ./deploy ennemi-vps --tags=nginx,certbot" >&2
    exit 1
fi
echo "$VPS_HOST:$VPS_PATH is ready."

echo ""
echo "Step 2/3: Building..."
echo "----------------------------------------"
npm run build

echo ""
echo "Step 3/3: Syncing dist/ to the VPS..."
echo "----------------------------------------"
# The web root is written by root on the remote side, so rsync runs under sudo.
rsync -az --delete --info=stats1 --rsync-path="sudo rsync" --chmod=D755,F644 dist/ "$VPS_HOST:$VPS_PATH/"

echo ""
echo "✓ Deployed."
