#!/bin/bash
set -e
cd "$(dirname "$0")"
[ -d server/node_modules ] || (cd server && npm ci)
[ -d web/node_modules ] || (cd web && npm ci)
export HOMEOS_DB=${HOMEOS_DB:-$PWD/server/data/dev.db}
export HOMEOS_ADMIN_PASSWORD=${HOMEOS_ADMIN_PASSWORD:-admin12345}
(cd server && node --watch --disable-warning=ExperimentalWarning index.js) &
trap 'kill $!' EXIT
cd web && npx vite --host
