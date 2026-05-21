#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/mesh-ble.config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "mesh-ble.config.json がありません。" >&2
  exit 1
fi

python3 - <<'PY' "$CONFIG_FILE"
import json
import sys
from collections import defaultdict
from pathlib import Path

config_path = Path(sys.argv[1])
config = json.loads(config_path.read_text(encoding="utf-8"))
required = ["redCycle", "redConfirm", "blueCycle", "blueConfirm", "refereeControl"]
blocks = config.get("blocks", [])
button_map = defaultdict(set)
local_name_to_button_ids = defaultdict(set)
sensor_names = []

for block in blocks:
    kind = str(block.get("kind", ""))
    local_name = str(block.get("localName", ""))
    if kind == "brightness":
        sensor_names.append(local_name)
    elif kind == "button":
        button_id = str(block.get("buttonId", ""))
        button_map[button_id].add(local_name)
        if local_name:
            local_name_to_button_ids[local_name].add(button_id)

print("mesh-ble.config.json summary")
print(f"  blocks: {len(blocks)}")
print(f"  goalSensor: {', '.join(sensor_names) if sensor_names else '(none)'}")
for button_id in required:
    names = sorted(name for name in button_map.get(button_id, set()) if name)
    print(f"  {button_id}: {', '.join(names) if names else '(missing)'}")
unique_button_names = sorted(name for name in local_name_to_button_ids if name)
print(f"  unique button blocks: {len(unique_button_names)}")

missing = [button_id for button_id in required if button_id not in button_map]
if missing:
    print("")
    print("Invalid config: missing button IDs -> " + ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)

shared = {
    local_name: sorted(button_ids)
    for local_name, button_ids in local_name_to_button_ids.items()
    if len(button_ids) > 1
}
if shared:
    print("")
    print("Invalid config: one physical button is assigned to multiple logical controls.", file=sys.stderr)
    for local_name, button_ids in sorted(shared.items()):
        print(f"  {local_name}: {', '.join(button_ids)}", file=sys.stderr)
    raise SystemExit(1)

if len(unique_button_names) < len(required):
    print("", file=sys.stderr)
    print(
        "Invalid config: current Logic PK implementation requires 5 distinct physical button blocks "
        f"but only {len(unique_button_names)} are configured.",
        file=sys.stderr,
    )
    raise SystemExit(1)
PY
