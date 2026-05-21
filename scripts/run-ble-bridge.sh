#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-mesh-ble"
REQ_FILE="$ROOT_DIR/server/mesh_ble_requirements.txt"
PYTHON_BIN="${PYTHON_BIN:-python3}"
BRIDGE_SCRIPT="$ROOT_DIR/server/mesh_ble_bridge.py"
CONFIG_FILE="$ROOT_DIR/mesh-ble.config.json"
EXAMPLE_FILE="$ROOT_DIR/mesh-ble.config.example.json"

existing_bridge_pids() {
  pgrep -f "$BRIDGE_SCRIPT" || true
}

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE" >/dev/null

if [ "${1:-}" = "--discover" ]; then
  PIDS="$(existing_bridge_pids)"
  if [ -n "$PIDS" ]; then
    echo "BLE bridge is already running: $PIDS" >&2
    echo "Stop it before discovery: npm run ble:stop" >&2
    exit 1
  fi
  exec "$VENV_DIR/bin/python" "$BRIDGE_SCRIPT" --discover
fi

if [ ! -f "$CONFIG_FILE" ]; then
  cp "$EXAMPLE_FILE" "$CONFIG_FILE"
  echo "Created $CONFIG_FILE" >&2
  echo "Edit localName values, then rerun this command." >&2
  exit 1
fi

PIDS="$(existing_bridge_pids)"
if [ -n "$PIDS" ]; then
  echo "BLE bridge is already running: $PIDS" >&2
  echo "Reusing the existing BLE bridge process." >&2
  exit 0
fi

exec "$VENV_DIR/bin/python" "$BRIDGE_SCRIPT" --config "$CONFIG_FILE" "$@"
