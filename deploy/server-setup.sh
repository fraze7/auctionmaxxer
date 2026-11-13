#!/usr/bin/env bash
# One-time setup of a fresh VPS. Runs on the server as root; safe to re-run.
#   ssh root@YOUR_SERVER_IP 'bash -s' < deploy/server-setup.sh
# Installs Node.js 24 and build tools, creates the "auction" user and
# /opt/auctionmaxxer. Code comes from deploy.sh; .env and the database are
# copied by hand.
set -euo pipefail

APP_DIR=/opt/auctionmaxxer
APP_USER=auction
NODE_MAJOR=24

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

echo "==> Installing Node.js ${NODE_MAJOR} and build tools"
# Build tools are only needed if better-sqlite3 has no prebuilt binary.
if command -v apt-get >/dev/null; then # Ubuntu / Debian
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates tar build-essential python3
  if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
elif command -v dnf >/dev/null; then # AlmaLinux / Rocky / RHEL
  dnf install -y curl ca-certificates tar gcc-c++ make python3
  if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    dnf install -y nodejs
  fi
else
  echo "Unsupported system: neither apt-get nor dnf found." >&2
  exit 1
fi

echo "==> Creating user '${APP_USER}' and ${APP_DIR}"
# No password and no login shell: the app can only touch its own folder.
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi
mkdir -p "${APP_DIR}/server/data"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo
echo "Done. node $(node --version), npm $(npm --version)"
echo "Next: copy .env and the database, then run deploy/deploy.sh from your PC."
