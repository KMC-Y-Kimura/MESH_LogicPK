#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${1:-http://127.0.0.1:3000}"
RESET_URL="${SERVER_URL%/}/api/control/reset"

if ! curl --fail --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$RESET_URL" >/dev/null; then
  echo "Failed to reset match via $RESET_URL" >&2
  echo "Server is not running or the endpoint is unreachable." >&2
  exit 1
fi

echo "Match state reset via $RESET_URL"
