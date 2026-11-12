#!/usr/bin/env bash
# One-time setup of a fresh VPS for the auctionmaxxer collector.
# Runs ON THE SERVER, as root. Safe to run again: every step checks first.
#
# From your PC (Git Bash), in the repo root:
#   ssh root@YOUR_SERVER_IP 'bash -s' < deploy/server-setup.sh
#
# What it does:
#   1. installs Node.js 24 (same major version as the dev PC) and build tools
#   2. creates an unprivileged user, "auction", that the collector runs as
#   3. creates /opt/auctionmaxxer, owned by that user
# It does not copy the code, .env or the database: deploy.sh does the code,
# and the two private files (.env, the database) are copied by hand once.
set -euo pipefail

APP_DIR=/opt/auctionmaxxer
APP_USER=auction
NODE_MAJOR=24

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

echo "==> Installing Node.js ${NODE_MAJOR} and build tools"
# Build tools are a fallback: better-sqlite3 normally downloads a ready-made
# binary, and only compiles from source if there isn't one for this system.
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
# A system user with no password and no login shell: if the collector were
# ever compromised, it could touch its own folder and nothing else.
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi
mkdir -p "${APP_DIR}/server/data"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo
echo "Done. node $(node --version), npm $(npm --version)"
echo "Next: copy .env and the database, then run deploy/deploy.sh from your PC."
