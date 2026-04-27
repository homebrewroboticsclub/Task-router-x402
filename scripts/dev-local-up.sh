#!/usr/bin/env bash
# Local dev: Node app with nodemon (no Docker). Requires .env with DATABASE_URL to host Postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -f .env ]]; then
  echo "Copy config/env.example to .env and set DATABASE_URL (e.g. postgres://x402:x402@127.0.0.1:5432/x402raid) and secrets."
  exit 1
fi
exec npm run dev
