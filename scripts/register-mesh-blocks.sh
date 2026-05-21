#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-mesh-ble"
REQ_FILE="$ROOT_DIR/server/mesh_ble_requirements.txt"
PYTHON_BIN="${PYTHON_BIN:-python3}"
REGISTER_SCRIPT="$ROOT_DIR/server/mesh_ble_register.py"
BRIDGE_SCRIPT="$ROOT_DIR/server/mesh_ble_bridge.py"

PIDS="$(pgrep -f "$BRIDGE_SCRIPT" || true)"
if [ -n "$PIDS" ]; then
  echo "BLE bridge is already running: $PIDS" >&2
  echo "Stop it before registration: npm run ble:stop" >&2
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE" >/dev/null

cd "$ROOT_DIR"
exec "$VENV_DIR/bin/python" "$REGISTER_SCRIPT" "$@"
