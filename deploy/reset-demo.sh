#!/bin/sh
#
# Rebuild the public demo's ledger from nothing. Run it nightly from cron:
#
#   0 4 * * * /srv/sundry/deploy/reset-demo.sh >> /var/log/sundry-demo-reset.log 2>&1
#
# Stop the API, delete the database file, run the seed, start the API. A demo
# instance is one container with one SQLite file and shares nothing with any
# other instance, so "reset" really is `rm` plus the seed script.
#
# The seed refuses to run without an explicit DB_PATH — its default would be a
# real ledger, and that guard is the reason this script reads the path from the
# instance's own env file instead of assuming one.
set -eu

# Resolve the repo root from this script's location: cron runs with a working
# directory that has nothing to do with where the code lives.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/demo.env}"

if [ ! -f "$ENV_FILE" ]; then
	echo "reset-demo: no env file at $ENV_FILE (copy deploy/instance.env.example)" >&2
	exit 1
fi

# Pull out the one value we need rather than sourcing the file. The file also
# holds APP_PASSWORD, and a password with a quote or a `$` in it would either
# break `.` or be expanded by it — neither is a thing to discover at 4am.
DB_PATH="$(sed -n 's/^[[:space:]]*DB_PATH=//p' "$ENV_FILE" | tail -n 1)"
DB_PATH="${DB_PATH:-/app/data/expenses.db}"

compose() {
	docker compose \
		-f "$ROOT/docker-compose.yml" \
		-f "$ROOT/docker-compose.demo.yml" \
		--env-file "$ENV_FILE" \
		"$@"
}

echo "==> $(date -u '+%Y-%m-%dT%H:%M:%SZ') resetting the demo ($ENV_FILE, $DB_PATH)"

# The API holds the database open; deleting it underneath a running process
# leaves a live handle to a file nobody can see.
echo "==> stopping the backend"
compose stop backend

# Delete and re-seed inside a one-off container rather than from the host: the
# path above is the container's, and the files belong to the image's `node`
# user. The -wal/-shm sidecars go too — SQLite in WAL mode will happily pair a
# leftover journal with a brand-new database.
echo "==> wiping and seeding"
compose run --rm -e DB_PATH="$DB_PATH" backend sh -c '
	set -eu
	rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"

	# The image runs `node dist/server.js`, so the seed has to survive the build
	# as well. If tsc ever stops emitting src/scripts/, stop here loudly instead
	# of leaving the demo frozen on day-one data with nothing in the logs.
	if [ ! -f dist/scripts/seed.js ]; then
		echo "reset-demo: dist/scripts/seed.js is missing — is src/scripts/ excluded from the build?" >&2
		exit 1
	fi

	node dist/scripts/seed.js
'

echo "==> starting the backend"
compose up -d backend

echo "==> done"
