#!/usr/bin/env bash
# Sets (or changes) the website's login. Installed on the server as
# /usr/local/sbin/auctionmaxxer-set-password by https-setup.sh.
#
# Run it from your PC - you type the password, nothing is stored in plain text:
#   ssh -t auctionmaxxer auctionmaxxer-set-password
#
# Only a hash of the password is saved (bcrypt): it can check a login, but
# can't be turned back into the password, even by someone who reads the file.
set -euo pipefail

AUTH_FILE=/etc/caddy/auth.conf
MIN_LENGTH=12

read -r -p "Username [admin]: " username
username=${username:-admin}
if ! [[ "${username}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Use only letters, digits, dot, dash and underscore in the username." >&2
  exit 1
fi

# -s: don't show the password on screen as it is typed.
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

# Passed on standard input, not as an argument, so the password never shows
# up in the server's process list.
hash=$(printf '%s\n' "${password}" | caddy hash-password)
unset password confirm

# Write the new login, check Caddy accepts the config, then apply it. If the
# check fails the old login is put back.
backup=$(mktemp)
cp "${AUTH_FILE}" "${backup}" 2>/dev/null || true
printf 'basicauth {\n\t%s %s\n}\n' "${username}" "${hash}" > "${AUTH_FILE}"
chown root:caddy "${AUTH_FILE}"
chmod 640 "${AUTH_FILE}"

# The Caddyfile reads the site's address from SITE_HOST. The running service
# gets it from this file; the check below needs it too, or it always fails.
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
