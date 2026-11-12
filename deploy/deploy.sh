#!/usr/bin/env bash
# Sends the current commit to the server and restarts the collector.
# Runs ON YOUR PC (Git Bash), from anywhere inside the repo:
#   deploy/deploy.sh root@YOUR_SERVER_IP
#
# It ships exactly what is committed (HEAD), not your working folder - so
# commit first. The GitHub repo is private, so instead of cloning it on the
# server we pipe a tarball of the commit straight over SSH. The server never
# needs GitHub access.
#
# Never touched by a deploy: server/.env and server/data/ (the database).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: deploy/deploy.sh root@YOUR_SERVER_IP" >&2
  exit 1
fi
TARGET=$1
APP_DIR=/opt/auctionmaxxer

cd "$(git rev-parse --show-toplevel)"
COMMIT=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain)" ]; then
  echo "Note: you have uncommitted changes. They are NOT deployed (only ${COMMIT} is)."
fi

echo "==> Uploading commit ${COMMIT}"
# Old source is removed first so a file deleted in git also disappears there.
git archive --format=tar HEAD server web deploy |
  ssh "${TARGET}" "
    set -e
    rm -rf ${APP_DIR}/server/src ${APP_DIR}/server/migrations ${APP_DIR}/web/src
    tar -x -C ${APP_DIR}
    chown -R auction:auction ${APP_DIR}
  "

echo "==> Installing dependencies and restarting"
ssh "${TARGET}" "
  set -e
  cd ${APP_DIR}/server
  # npm ci = install exactly what package-lock.json says. Run as the app user.
  runuser -u auction -- npm ci --no-audit --no-fund
  # Build the web app into web/dist, which the API server then serves.
  cd ${APP_DIR}/web
  runuser -u auction -- npm ci --no-audit --no-fund
  runuser -u auction -- npm run build
  cd ${APP_DIR}/server
  # Install the systemd units: the collector, and the nightly backup + its timer.
  install -m 644 ${APP_DIR}/deploy/*.service ${APP_DIR}/deploy/*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable auctionmaxxer auctionmaxxer-api >/dev/null 2>&1
  systemctl enable --now auctionmaxxer-backup.timer >/dev/null 2>&1
  if [ -f .env ]; then
    systemctl restart auctionmaxxer auctionmaxxer-api
    sleep 8
    systemctl --no-pager --lines=6 status auctionmaxxer auctionmaxxer-api || true
  else
    echo 'No .env on the server yet - code installed, collector NOT started.'
  fi
"
echo "==> Deployed ${COMMIT}"
