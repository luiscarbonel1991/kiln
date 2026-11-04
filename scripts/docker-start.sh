#!/bin/sh
# The app container's start: migrate the database (and the mock runs' own,
# in mock mode), then serve on every interface of the container.
set -e
pnpm exec prisma migrate deploy
if [ "$KILN_PROVIDERS" = "mock" ]; then
  node scripts/mock-db.mjs
fi
exec pnpm exec next start -H 0.0.0.0 -p 3000
