#!/usr/bin/env bash
# Reinstall Node dependencies after package.json / lockfile changes.
# Normal code edits are picked up by nodemon without this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm install
echo "OK: npm install"
