#!/usr/bin/env bash
# Copies the newest database backup from the server to server/data/backups/.
# Run on your PC (Git Bash):
#   deploy/pull-backup.sh auctionmaxxer
# To restore: gunzip it; the result is a normal SQLite file.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: deploy/pull-backup.sh auctionmaxxer   (or root@YOUR_SERVER_IP)" >&2
  exit 1
fi
TARGET=$1
REMOTE_DIR=/opt/auctionmaxxer/server/data/backups

cd "$(git rev-parse --show-toplevel)"
mkdir -p server/data/backups

# Dated names sort as text, so the last is the newest.
NEWEST=$(ssh "${TARGET}" "ls ${REMOTE_DIR} 2>/dev/null | grep -E '^auctionmaxxer-[0-9-]+\.db\.gz$' | sort | tail -1")
if [ -z "${NEWEST}" ]; then
  echo "No backups on the server yet." >&2
  exit 1
fi

scp -q "${TARGET}:${REMOTE_DIR}/${NEWEST}" "server/data/backups/${NEWEST}"
# Check the download isn't truncated or corrupt.
gzip -t "server/data/backups/${NEWEST}"
echo "Fetched server/data/backups/${NEWEST} ($(du -h "server/data/backups/${NEWEST}" | cut -f1))"
