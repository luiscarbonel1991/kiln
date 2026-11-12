#!/bin/sh
# The app container's start: migrate the database (and the mock runs' own,
# in mock mode), then serve on every interface of the container.
set -e
# Kiln's own key for what it keeps sealed (the provider keys saved in Settings,
# a connected shop's tokens): the one .env gives, or one made on the first
# start and kept in the kiln-secrets volume.
if [ -z "$KILN_SECRET_KEY" ]; then
  mkdir -p /app/.kiln
  if [ ! -s /app/.kiln/secret-key ]; then
    (umask 077 && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' > /app/.kiln/secret-key)
  fi
  KILN_SECRET_KEY="$(cat /app/.kiln/secret-key)"
  export KILN_SECRET_KEY
fi
pnpm exec prisma migrate deploy
if [ "$KILN_PROVIDERS" = "mock" ]; then
  node scripts/mock-db.mjs
fi
exec pnpm exec next start -H 0.0.0.0 -p 3000
