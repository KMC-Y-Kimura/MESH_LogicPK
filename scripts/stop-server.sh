#!/usr/bin/env bash
set -euo pipefail

PIDS="$(lsof -tiTCP:3000 -sTCP:LISTEN || true)"

if [ -z "$PIDS" ]; then
  echo "No server process is listening on port 3000."
  exit 0
fi

echo "Stopping server process(es) on port 3000: $PIDS"
kill $PIDS
