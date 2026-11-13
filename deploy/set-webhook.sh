#!/usr/bin/env bash
# Connects watchlist alerts to a Discord channel (or disconnects them).
# Installed on the server as /usr/local/sbin/auctionmaxxer-set-webhook by
# deploy.sh.
#
# Run it from your PC and paste the webhook address when asked:
#   ssh -t auctionmaxxer auctionmaxxer-set-webhook
#
# Where the address comes from: in Discord, open the channel's settings ->
# Integrations -> Webhooks -> New Webhook -> Copy Webhook URL.
#
# The address works like a password - anyone who has it can post to that
# channel - so it is typed here instead of being put in the code or in git.
# It ends up in server/.env, which only the app's own user can read.
set -euo pipefail

ENV_FILE=/opt/auctionmaxxer/server/.env
if [ ! -f "${ENV_FILE}" ]; then
  echo "No ${ENV_FILE} on this server yet. Nothing was changed." >&2
  exit 1
fi

# -s: don't show the address on screen as it is pasted.
read -r -s -p "Discord webhook address (hidden; leave empty to turn alerts off): " url
echo

if [ -n "${url}" ]; then
  if ! [[ "${url}" =~ ^https://(discord\.com|discordapp\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$ ]]; then
    echo "That doesn't look like a Discord webhook address" >&2
    echo "(expected https://discord.com/api/webhooks/<numbers>/<letters>). Nothing was changed." >&2
    exit 1
  fi

  # Prove it works before saving it: post a hello message. The address goes
  # to curl on standard input, not as an argument, so it never shows up in the
  # server's process list.
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

# Rewrite .env without the old lines, then add the new ones. The copy is made
# private (umask 077) and written back INTO the existing file, so the file
# keeps its owner and permissions.
umask 077
tmp=$(mktemp)
trap 'rm -f "${tmp}"' EXIT
grep -v -E '^(DISCORD_WEBHOOK_URL|SITE_URL)=' "${ENV_FILE}" > "${tmp}" || true

if [ -n "${url}" ]; then
  printf 'DISCORD_WEBHOOK_URL=%s\n' "${url}" >> "${tmp}"
  # The site's address, so item names in alerts link to their page.
  if [ -f /etc/caddy/site.env ]; then
    . /etc/caddy/site.env
    [ -n "${SITE_HOST:-}" ] && printf 'SITE_URL=https://%s\n' "${SITE_HOST}" >> "${tmp}"
  fi
fi
unset url

cat "${tmp}" > "${ENV_FILE}"

# Both programs read .env only when they start.
systemctl restart auctionmaxxer auctionmaxxer-api
if grep -q '^DISCORD_WEBHOOK_URL=' "${ENV_FILE}"; then
  echo "Done. Watchlist alerts now go to Discord."
else
  echo "Done. Discord alerts are off; alerts still show on the site."
fi
