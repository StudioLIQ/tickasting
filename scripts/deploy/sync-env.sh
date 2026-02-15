#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SYNC_VERCEL=false
SYNC_RAILWAY=false
DRY_RUN=false

VERCEL_ENV_FILE="${VERCEL_ENV_FILE:-$ROOT_DIR/deploy/env/vercel-web.env}"
VERCEL_PROJECT_DIR="${VERCEL_PROJECT_DIR:-$ROOT_DIR/apps/web}"
VERCEL_TARGETS="${VERCEL_TARGETS:-production,preview,development}"

RAILWAY_API_ENV_FILE="${RAILWAY_API_ENV_FILE:-$ROOT_DIR/deploy/env/railway-api.env}"
RAILWAY_PONDER_ENV_FILE="${RAILWAY_PONDER_ENV_FILE:-$ROOT_DIR/deploy/env/railway-ponder.env}"
RAILWAY_API_SERVICE="${RAILWAY_API_SERVICE:-tickasting-api}"
RAILWAY_PONDER_SERVICE="${RAILWAY_PONDER_SERVICE:-tickasting-ponder}"

ENV_KEYS=()
ENV_VALUES=()

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy/sync-env.sh [--all] [--vercel] [--railway] [--dry-run]

Description:
  Sync deploy env files to hosting platforms in one command.

Options:
  --all       Sync both Vercel and Railway (default when no target flag is provided)
  --vercel    Sync only Vercel from deploy/env/vercel-web.env
  --railway   Sync only Railway from deploy/env/railway-api.env + railway-ponder.env
  --dry-run   Print actions without executing platform CLI calls
  -h, --help  Show this help

Optional env vars:
  VERCEL_ENV_FILE
  VERCEL_PROJECT_DIR
  VERCEL_TARGETS              (comma-separated, default: production,preview,development)
  VERCEL_TOKEN
  VERCEL_SCOPE

  RAILWAY_API_ENV_FILE
  RAILWAY_PONDER_ENV_FILE
  RAILWAY_API_SERVICE
  RAILWAY_PONDER_SERVICE
  RAILWAY_PROJECT_ID
  RAILWAY_ENVIRONMENT_ID
  RAILWAY_TOKEN
EOF
}

trim() {
  local input="$1"
  input="${input#"${input%%[![:space:]]*}"}"
  input="${input%"${input##*[![:space:]]}"}"
  printf '%s' "$input"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] Required command not found: $cmd" >&2
    exit 1
  fi
}

parse_env_file() {
  local file="$1"
  ENV_KEYS=()
  ENV_VALUES=()

  if [[ ! -f "$file" ]]; then
    echo "[error] Env file not found: $file" >&2
    exit 1
  fi

  while IFS= read -r raw || [[ -n "$raw" ]]; do
    local line="${raw%$'\r'}"
    line="$(trim "$line")"

    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^# ]] && continue

    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
      line="$(trim "$line")"
    fi

    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(trim "$key")"
    value="$(trim "$value")"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "[warn] Skip invalid key in $file: $key" >&2
      continue
    fi

    if [[ ${#value} -ge 2 ]]; then
      local first_char="${value:0:1}"
      local last_char="${value:${#value}-1:1}"
      if [[ "$first_char" == '"' && "$last_char" == '"' ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$first_char" == "'" && "$last_char" == "'" ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    ENV_KEYS+=("$key")
    ENV_VALUES+=("$value")
  done < "$file"
}

sync_vercel() {
  require_command vercel

  if [[ ! -d "$VERCEL_PROJECT_DIR" ]]; then
    echo "[error] Vercel project directory not found: $VERCEL_PROJECT_DIR" >&2
    exit 1
  fi

  parse_env_file "$VERCEL_ENV_FILE"

  local vercel_args=(--cwd "$VERCEL_PROJECT_DIR")
  if [[ -n "${VERCEL_TOKEN:-}" ]]; then
    vercel_args+=(-t "$VERCEL_TOKEN")
  fi
  if [[ -n "${VERCEL_SCOPE:-}" ]]; then
    vercel_args+=(-S "$VERCEL_SCOPE")
  fi

  if [[ ! -f "$VERCEL_PROJECT_DIR/.vercel/project.json" ]]; then
    echo "[warn] Missing $VERCEL_PROJECT_DIR/.vercel/project.json (run 'vercel link' once if needed)." >&2
  fi

  IFS=',' read -r -a targets <<< "$VERCEL_TARGETS"
  local idx target key value

  for ((idx = 0; idx < ${#ENV_KEYS[@]}; idx += 1)); do
    key="${ENV_KEYS[$idx]}"
    value="${ENV_VALUES[$idx]}"

    if [[ -z "$value" ]]; then
      echo "[vercel] skip empty value: $key"
      continue
    fi

    for target in "${targets[@]}"; do
      target="$(trim "$target")"
      [[ -z "$target" ]] && continue

      echo "[vercel] set $key ($target)"
      if [[ "$DRY_RUN" == "true" ]]; then
        continue
      fi

      if printf '%s' "$value" | vercel env add "$key" "$target" --force "${vercel_args[@]}" >/dev/null 2>&1; then
        continue
      fi

      if printf '%s' "$value" | vercel env update "$key" "$target" -y "${vercel_args[@]}" >/dev/null 2>&1; then
        continue
      fi

      echo "[error] Failed to set Vercel env: $key ($target)" >&2
      printf '%s' "$value" | vercel env add "$key" "$target" --force "${vercel_args[@]}"
      exit 1
    done
  done
}

set_railway_variable() {
  local service="$1"
  local key="$2"
  local value="$3"

  local railway_context=()
  if [[ -n "${RAILWAY_PROJECT_ID:-}" ]]; then
    railway_context+=(-p "$RAILWAY_PROJECT_ID")
  fi
  if [[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ]]; then
    railway_context+=(-e "$RAILWAY_ENVIRONMENT_ID")
  fi

  if railway "${railway_context[@]}" variable set "${key}=${value}" -s "$service" >/dev/null 2>&1; then
    return 0
  fi
  if railway "${railway_context[@]}" variable set "$key" "$value" -s "$service" >/dev/null 2>&1; then
    return 0
  fi
  if railway "${railway_context[@]}" variables --set "${key}=${value}" -s "$service" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

sync_railway_service_file() {
  local env_file="$1"
  local service="$2"
  local label="$3"

  parse_env_file "$env_file"

  local idx key value
  for ((idx = 0; idx < ${#ENV_KEYS[@]}; idx += 1)); do
    key="${ENV_KEYS[$idx]}"
    value="${ENV_VALUES[$idx]}"

    if [[ -z "$value" ]]; then
      echo "[railway:$label] skip empty value: $key"
      continue
    fi

    echo "[railway:$label] set $key"
    if [[ "$DRY_RUN" == "true" ]]; then
      continue
    fi

    if ! set_railway_variable "$service" "$key" "$value"; then
      echo "[error] Failed to set Railway env: $key (service=$service)" >&2
      return 1
    fi
  done
}

sync_railway() {
  require_command railway
  sync_railway_service_file "$RAILWAY_API_ENV_FILE" "$RAILWAY_API_SERVICE" "api"
  sync_railway_service_file "$RAILWAY_PONDER_ENV_FILE" "$RAILWAY_PONDER_SERVICE" "ponder"
}

while (($# > 0)); do
  case "$1" in
    --all)
      SYNC_VERCEL=true
      SYNC_RAILWAY=true
      ;;
    --vercel)
      SYNC_VERCEL=true
      ;;
    --railway)
      SYNC_RAILWAY=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[error] Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ "$SYNC_VERCEL" == "false" && "$SYNC_RAILWAY" == "false" ]]; then
  SYNC_VERCEL=true
  SYNC_RAILWAY=true
fi

if [[ "$SYNC_VERCEL" == "true" ]]; then
  sync_vercel
fi

if [[ "$SYNC_RAILWAY" == "true" ]]; then
  sync_railway
fi

echo "[done] Environment sync completed."
