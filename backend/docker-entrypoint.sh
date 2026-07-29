#!/bin/sh
set -e

# The data directory is a bind mount from the host, so its ownership belongs to
# whoever created it there — it cannot be baked into the image. Fix it once at
# start-up while we still have the privileges to do so, then hand the actual
# server process to the unprivileged `node` user.
#
# This is why the image does not simply declare `USER node`: doing that would
# leave an existing install unable to open its own database (SQLITE_CANTOPEN)
# the moment it upgraded.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec su-exec node "$@"
fi

# Already unprivileged (e.g. `docker run --user`): nothing to drop.
exec "$@"
