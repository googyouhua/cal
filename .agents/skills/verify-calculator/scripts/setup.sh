#!/usr/bin/env bash
# Make the Playwright driver runnable. Safe to run repeatedly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
TOOLS_DIR="$SKILL_DIR/tools"

if node "$SCRIPT_DIR/doctor.mjs" --resolve-only >/dev/null 2>&1; then
  echo "playwright=present"
  exit 0
fi

mkdir -p "$TOOLS_DIR"
if [[ ! -f "$TOOLS_DIR/package.json" ]]; then
  cat >"$TOOLS_DIR/package.json" <<'JSON'
{
  "name": "verify-calculator-tools",
  "private": true,
  "description": "Verification-only dependency for the verify-calculator skill. Not part of the app."
}
JSON
fi

echo "installing playwright into $TOOLS_DIR (network required)"
npm install --prefix "$TOOLS_DIR" --no-audit --no-fund playwright@1.64.0
npx --prefix "$TOOLS_DIR" playwright install chromium
echo "playwright=installed dir=$TOOLS_DIR"
