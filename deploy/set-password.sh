#!/usr/bin/env bash
# Sets the website's login. Only a bcrypt hash is stored.
#   ssh -t auctionmaxxer auctionmaxxer-set-password
set -euo pipefail

AUTH_FILE=/etc/caddy/auth.conf
MIN_LENGTH=12

read -r -p "Username [admin]: " username
username=${username:-admin}
if ! [[ "${username}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Use only letters, digits, dot, dash and underscore in the username." >&2
  exit 1
fi

read -r -s -p "Password (at least ${MIN_LENGTH} characters): " password
echo
read -r -s -p "Same password again: " confirm
echo
if [ "${password}" != "${confirm}" ]; then
  echo "The two passwords don't match. Nothing was changed." >&2
  exit 1
fi
if [ "${#password}" -lt "${MIN_LENGTH}" ]; then
  echo "Too short: this login faces the whole internet. Nothing was changed." >&2
  exit 1
fi

# On stdin, not as an argument, so it never appears in the process list.
hash=$(printf '%s\n' "${password}" | caddy hash-password)
unset password confirm

# Write the new login, validate, then reload. The old login is restored on failure.
backup=$(mktemp)
cp "${AUTH_FILE}" "${backup}" 2>/dev/null || true
printf 'basicauth {\n\t%s %s\n}\n' "${username}" "${hash}" > "${AUTH_FILE}"
chown root:caddy "${AUTH_FILE}"
chmod 640 "${AUTH_FILE}"

# `caddy validate` needs SITE_HOST, as the running service does.
set -a
. /etc/caddy/site.env
set +a

if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  cp "${backup}" "${AUTH_FILE}"
  rm -f "${backup}"
  echo "Caddy rejected the new config. The old login is still in place." >&2
  exit 1
fi
rm -f "${backup}"
systemctl reload caddy
echo "Done. Log in as '${username}' with the password you just typed."
