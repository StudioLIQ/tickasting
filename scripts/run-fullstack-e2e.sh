#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  echo "[fullstack] .env not found at repo root"
  exit 1
fi

set -a
source ".env"
set +a

docker compose -f infra/docker-compose.yml up -d >/dev/null

pnpm --filter @tickasting/shared build >/dev/null

API_LOG="$(mktemp -t tickasting-api.XXXX.log)"
PONDER_LOG="$(mktemp -t tickasting-ponder.XXXX.log)"
WEB_LOG="$(mktemp -t tickasting-web.XXXX.log)"

API_PID=""
PONDER_PID=""
WEB_PID=""

cleanup() {
  set +e
  if [[ -n "${WEB_PID}" ]]; then kill "${WEB_PID}" 2>/dev/null || true; fi
  if [[ -n "${PONDER_PID}" ]]; then kill "${PONDER_PID}" 2>/dev/null || true; fi
  if [[ -n "${API_PID}" ]]; then kill "${API_PID}" 2>/dev/null || true; fi
  wait "${WEB_PID}" 2>/dev/null || true
  wait "${PONDER_PID}" 2>/dev/null || true
  wait "${API_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "[fullstack] starting API (log: ${API_LOG})"
pnpm --filter @tickasting/api dev >"${API_LOG}" 2>&1 &
API_PID=$!

echo "[fullstack] starting Ponder (log: ${PONDER_LOG})"
pnpm --filter @tickasting/ponder dev >"${PONDER_LOG}" 2>&1 &
PONDER_PID=$!

echo "[fullstack] starting Web (log: ${WEB_LOG})"
pnpm --filter @tickasting/web dev >"${WEB_LOG}" 2>&1 &
WEB_PID=$!

echo "[fullstack] running fullstack checks"
pnpm --filter @tickasting/api e2e:fullstack:check

echo "[fullstack] done"
