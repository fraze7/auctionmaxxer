#!/usr/bin/env bash
# Connects watchlist alerts to a Discord channel, or disconnects them.
#   ssh -t auctionmaxxer auctionmaxxer-set-webhook
# The webhook address (channel settings -> Integrations -> Webhooks) works like
# a password, so it is typed here and stored only in server/.env.
set -euo pipefail

ENV_FILE=/opt/auctionmaxxer/server/.env
if [ ! -f "${ENV_FILE}" ]; then
  echo "No ${ENV_FILE} on this server yet. Nothing was changed." >&2
  exit 1
fi

read -r -s -p "Discord webhook address (hidden; leave empty to turn alerts off): " url
echo

if [ -n "${url}" ]; then
  if ! [[ "${url}" =~ ^https://(discord\.com|discordapp\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$ ]]; then
    echo "That doesn't look like a Discord webhook address" >&2
    echo "(expected https://discord.com/api/webhooks/<numbers>/<letters>). Nothing was changed." >&2
    exit 1
  fi

  # Send a test message before saving. The address goes to curl on stdin, not as
  # an argument, so it never appears in the process list.
  status=$(printf 'url = "%s"\n' "${url}" |
    curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 \
      --header 'Content-Type: application/json' \
      --data '{"content":"auctionmaxxer is connected. Price alerts will appear here."}' \
      --config - || true)
  if [ "${status}" != "204" ] && [ "${status}" != "200" ]; then
    echo "Discord didn't accept a test message (answer: ${status:-none}). Nothing was changed." >&2
    exit 1
  fi
  echo "Test message sent - check the channel."
fi

# Written back into the existing file so it keeps its owner and permissions.
umask 077
tmp=$(mktemp)
trap 'rm -f "${tmp}"' EXIT
grep -v -E '^(DISCORD_WEBHOOK_URL|SITE_URL)=' "${ENV_FILE}" > "${tmp}" || true

if [ -n "${url}" ]; then
  printf 'DISCORD_WEBHOOK_URL=%s\n' "${url}" >> "${tmp}"
  # So item names in alerts link to the site.
  if [ -f /etc/caddy/site.env ]; then
    . /etc/caddy/site.env
    [ -n "${SITE_HOST:-}" ] && printf 'SITE_URL=https://%s\n' "${SITE_HOST}" >> "${tmp}"
  fi
fi
unset url

cat "${tmp}" > "${ENV_FILE}"

# Both services read .env only at start-up.
systemctl restart auctionmaxxer auctionmaxxer-api
if grep -q '^DISCORD_WEBHOOK_URL=' "${ENV_FILE}"; then
  echo "Done. Watchlist alerts now go to Discord."
else
  echo "Done. Discord alerts are off; alerts still show on the site."
fi
