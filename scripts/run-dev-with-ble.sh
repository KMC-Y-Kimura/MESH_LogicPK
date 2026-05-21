#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/mesh-ble.config.json"

check_ble_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "mesh-ble.config.json がありません。" >&2
    echo "先に npm run ble:register を実行してください。" >&2
    return 1
  fi

  python3 - <<'PY' "$CONFIG_FILE"
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
required = {"redCycle", "redConfirm", "blueCycle", "blueConfirm", "refereeControl"}
config = json.loads(config_path.read_text(encoding="utf-8"))
button_ids = set()
button_names_by_id = {}
local_name_to_button_ids = {}
for block in config.get("blocks", []):
    if str(block.get("kind", "")) != "button":
        continue
    button_id = str(block.get("buttonId", "")).strip()
    local_name = str(block.get("localName", "")).strip()
    if not button_id:
        continue
    button_ids.add(button_id)
    button_names_by_id.setdefault(button_id, set())
    if local_name:
        button_names_by_id[button_id].add(local_name)
        local_name_to_button_ids.setdefault(local_name, set()).add(button_id)
missing = sorted(required - button_ids)
if missing:
    print(
        "mesh-ble.config.json が旧構成です。足りない buttonId: "
        + ", ".join(missing),
        file=sys.stderr,
    )
    print("npm run ble:register を実行して再登録してください。", file=sys.stderr)
    raise SystemExit(1)
shared = {
    local_name: sorted(button_id_set)
    for local_name, button_id_set in local_name_to_button_ids.items()
    if len(button_id_set) > 1
}
if shared:
    print(
        "mesh-ble.config.json が不正です。同じ物理ボタンが複数の論理ボタンに割り当てられています。",
        file=sys.stderr,
    )
    for local_name, ids in sorted(shared.items()):
        print(f"  {local_name}: {', '.join(ids)}", file=sys.stderr)
    print("各論理ボタンに別々の MESH ボタンを割り当てて再登録してください。", file=sys.stderr)
    raise SystemExit(1)
unique_button_names = {
    local_name
    for names in button_names_by_id.values()
    for local_name in names
    if local_name
}
if len(unique_button_names) < len(required):
    print(
        "mesh-ble.config.json の物理ボタン数が不足しています。"
        f"必要: {len(required)} 個, 現在: {len(unique_button_names)} 個",
        file=sys.stderr,
    )
    print("Current Logic PK implementation requires 5 distinct button blocks.", file=sys.stderr)
    raise SystemExit(1)
PY
}

check_ble_config

if pgrep -f "$ROOT_DIR/server/mesh_ble_bridge.py" >/dev/null 2>&1; then
  echo "BLE bridge is already running. Reusing the existing BLE bridge process." >&2
  if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 3000 is already in use. Reusing the existing server process." >&2
    cd "$ROOT_DIR"
    exec npx concurrently "npm run dev:client"
  fi
  cd "$ROOT_DIR"
  exec npx concurrently "npm run dev:server" "npm run dev:client"
fi

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 is already in use. Reusing the existing server process." >&2
  cd "$ROOT_DIR"
  exec npx concurrently "npm run dev:client" "npm run dev:ble"
fi

cd "$ROOT_DIR"
exec npx concurrently "npm run dev:server" "npm run dev:client" "npm run dev:ble"
