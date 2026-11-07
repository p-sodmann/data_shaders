#!/bin/sh
# MARS_BASIC_AUTH="<user> <bcrypt hash>" puts HTTP basic auth in front of everything, /prom
# and /api/keys included, except /healthz (the compose healthcheck) and /push/* (clients send
# their own push key there, ADR-0010). Unset, the display is open to the LAN
# like before. Make a hash with: caddy hash-password  (or: docker run --rm caddy:2-alpine
# caddy hash-password --plaintext '…'). See deploy/README.md#security.
set -eu

snippet=/etc/caddy/auth.caddy
: >"$snippet"
if [ -n "${MARS_BASIC_AUTH:-}" ]; then
	user=${MARS_BASIC_AUTH%% *}
	hash=${MARS_BASIC_AUTH#* }
	# No space means no hash; the character sets keep the value from injecting Caddyfile syntax.
	case "$user:$hash" in
	"$MARS_BASIC_AUTH:$MARS_BASIC_AUTH" | :* | *: | *[!A-Za-z0-9._@:/\$=+-]*)
		echo "mars: MARS_BASIC_AUTH must be '<user> <bcrypt hash>'" >&2
		exit 1
		;;
	esac
	cat >"$snippet" <<-SNIPPET
		@locked not path /healthz /push/*
		basic_auth @locked {
			$user $hash
		}
	SNIPPET
	echo "mars: basic auth on for user $user" >&2
fi
exec "$@"
