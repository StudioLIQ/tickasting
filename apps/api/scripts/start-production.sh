#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[api] Missing DATABASE_URL" >&2
  exit 1
fi

API_DATABASE_SCHEMA="${API_DATABASE_SCHEMA:-${DATABASE_SCHEMA:-api}}"
export API_DATABASE_SCHEMA

RESOLVED_DATABASE_URL="$(
  node -e 'const raw = process.env.DATABASE_URL; const schema = process.env.API_DATABASE_SCHEMA || "api"; const u = new URL(raw); u.searchParams.set("schema", schema); process.stdout.write(u.toString());'
)"
export DATABASE_URL="$RESOLVED_DATABASE_URL"

echo "[api] Using schema '${API_DATABASE_SCHEMA}'"

# Prefer migration history, fallback to schema push for pre-existing DB states.
prisma migrate deploy || prisma db push --skip-generate

exec node dist/index.js
