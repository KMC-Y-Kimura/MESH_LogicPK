#!/usr/bin/env bash
set -euo pipefail

BRIDGE_MATCH="server/mesh_ble_bridge.py"
PIDS="$(pgrep -f "$BRIDGE_MATCH" || true)"

if [ -z "$PIDS" ]; then
  echo "No BLE bridge process found."
  exit 0
fi

echo "Stopping BLE bridge process(es): $PIDS"
kill $PIDS
