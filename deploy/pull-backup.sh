#!/usr/bin/env bash
# Copies the newest database backup from the server to this PC, so a copy
# exists somewhere other than the server. Runs ON YOUR PC (Git Bash):
#   deploy/pull-backup.sh auctionmaxxer
#
# Backups land in server/data/backups/ (git-ignored). The server makes one a
# night and keeps 14; this script only fetches, it never deletes anything.
#
# To restore one: gunzip it, and it is a normal SQLite .db file.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: deploy/pull-backup.sh auctionmaxxer   (or root@YOUR_SERVER_IP)" >&2
  exit 1
fi
TARGET=$1
REMOTE_DIR=/opt/auctionmaxxer/server/data/backups

cd "$(git rev-parse --show-toplevel)"
mkdir -p server/data/backups

# Names contain the date (auctionmaxxer-2026-11-13.db.gz), so the last one
# in sorted order is the newest.
NEWEST=$(ssh "${TARGET}" "ls ${REMOTE_DIR} 2>/dev/null | grep -E '^auctionmaxxer-[0-9-]+\.db\.gz$' | sort | tail -1")
if [ -z "${NEWEST}" ]; then
  echo "No backups on the server yet." >&2
  exit 1
fi

scp -q "${TARGET}:${REMOTE_DIR}/${NEWEST}" "server/data/backups/${NEWEST}"
# gzip -t checks the file isn't cut short or corrupted.
gzip -t "server/data/backups/${NEWEST}"
echo "Fetched server/data/backups/${NEWEST} ($(du -h "server/data/backups/${NEWEST}" | cut -f1))"
