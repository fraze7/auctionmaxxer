#!/usr/bin/env bash
# Deploys the committed HEAD (not the working folder) to the server and restarts
# the services. Run on your PC (Git Bash):
#   deploy/deploy.sh auctionmaxxer
# Never touches server/.env or server/data/.
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
# Remove old source first, so files deleted in git disappear there too.
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
  # npm ci installs exactly what package-lock.json says.
  runuser -u auction -- npm ci --no-audit --no-fund
  # The API serves web/dist.
  cd ${APP_DIR}/web
  runuser -u auction -- npm ci --no-audit --no-fund
  runuser -u auction -- npm run build
  cd ${APP_DIR}/server
  install -m 644 ${APP_DIR}/deploy/*.service ${APP_DIR}/deploy/*.timer /etc/systemd/system/
  install -m 755 ${APP_DIR}/deploy/set-webhook.sh /usr/local/sbin/auctionmaxxer-set-webhook
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
