#!/usr/bin/env bash
# One-time setup of public HTTPS access with a login. Runs ON THE SERVER, as
# root. Safe to run again.
#
# From your PC (Git Bash), in the repo root - SITE_HOST is the address the
# site will have. With no domain of your own, sslip.io gives every IP a name:
# 203.0.113.7 becomes 203-0-113-7.sslip.io.
#
#   tar -c -C deploy Caddyfile set-password.sh https-setup.sh |
#     ssh auctionmaxxer 'rm -rf /tmp/https && mkdir /tmp/https && tar -x -C /tmp/https &&
#       bash /tmp/https/https-setup.sh YOUR-ADDRESS.sslip.io'
#
# The site comes up LOCKED: nobody can log in until you choose a password with
#   ssh -t auctionmaxxer auctionmaxxer-set-password
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: https-setup.sh SITE_HOST   (e.g. 203-0-113-7.sslip.io)" >&2
  exit 1
fi
SITE_HOST=$1
HERE=$(cd "$(dirname "$0")" && pwd)

echo "==> Installing Caddy"
export DEBIAN_FRONTEND=noninteractive
command -v caddy >/dev/null || apt-get install -y caddy

echo "==> Installing config for ${SITE_HOST}"
install -m 644 "${HERE}/Caddyfile" /etc/caddy/Caddyfile
install -m 755 "${HERE}/set-password.sh" /usr/local/sbin/auctionmaxxer-set-password

# Tell Caddy's service which address to serve (the Caddyfile reads SITE_HOST).
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=SITE_HOST=%s\n' "${SITE_HOST}" > /etc/systemd/system/caddy.service.d/site.conf

# No login yet? Lock the door: a random password that is thrown away at once,
# so the site is never reachable without one. An existing login is kept.
if [ ! -s /etc/caddy/auth.conf ]; then
  hash=$(printf '%s\n' "$(head -c 32 /dev/urandom | base64)" | caddy hash-password)
  printf 'basicauth {\n\tlocked %s\n}\n' "${hash}" > /etc/caddy/auth.conf
  chown root:caddy /etc/caddy/auth.conf
  chmod 640 /etc/caddy/auth.conf
fi

SITE_HOST=${SITE_HOST} caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl daemon-reload
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

echo "Done. https://${SITE_HOST} is up and locked."
echo "Choose the login with: ssh -t auctionmaxxer auctionmaxxer-set-password"
