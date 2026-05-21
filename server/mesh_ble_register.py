#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

from bleak import BleakScanner

MESH_PREFIX = "MESH-100"
KIND_PREFIX = {
    "button": "MESH-100BU",
    "brightness": "MESH-100PA",
}


@dataclass
class MeshDevice:
    name: str
    address: str


@dataclass
class AssignmentGroup:
    label: str
    kind: str
    current_name: str
    triggers: list[str]
    blocks: list[dict]


def load_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_config(path: Path, config: dict) -> None:
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_button_assignments(config: dict) -> list[str]:
    errors: list[str] = []
    blocks_by_name: dict[str, list[dict]] = {}

    for block in config.get("blocks", []):
        local_name = str(block.get("localName", "")).strip()
        if not local_name:
            continue
        blocks_by_name.setdefault(local_name, []).append(block)

    for local_name, grouped_blocks in blocks_by_name.items():
        kinds = {str(block.get("kind", "")) for block in grouped_blocks}
        if len(kinds) > 1:
            roles = ", ".join(str(block.get("role", "?")) for block in grouped_blocks)
            errors.append(f"{local_name}: conflicting kinds across roles ({roles})")
            continue

        if kinds != {"button"} and len(grouped_blocks) > 1:
            roles = ", ".join(str(block.get("role", "?")) for block in grouped_blocks)
            errors.append(f"{local_name}: duplicate non-button assignment ({roles})")
            continue

        if kinds == {"button"}:
            button_ids = sorted(
                {
                    str(block.get("buttonId", "")).strip()
                    for block in grouped_blocks
                    if str(block.get("buttonId", "")).strip()
                }
            )
            if len(button_ids) > 1:
                errors.append(
                    f"{local_name}: one physical button cannot be shared across multiple logical controls "
                    f"({', '.join(button_ids)})"
                )

    return errors


def build_assignment_groups(config: dict) -> list[AssignmentGroup]:
    groups: list[AssignmentGroup] = []
    button_groups: dict[str, AssignmentGroup] = {}

    for block in config.get("blocks", []):
        role = str(block.get("role", "unknown"))
        kind = str(block.get("kind", ""))
        current_name = str(block.get("localName", ""))

        if kind != "button":
            groups.append(
                AssignmentGroup(
                    label=role,
                    kind=kind,
                    current_name=current_name,
                    triggers=[],
                    blocks=[block],
                )
            )
            continue

        button_id = str(block.get("buttonId", role))
        group = button_groups.get(button_id)
        if group is None:
            group = AssignmentGroup(
                label=button_id,
                kind=kind,
                current_name=current_name,
                triggers=[],
                blocks=[],
            )
            button_groups[button_id] = group
            groups.append(group)

        trigger = str(block.get("trigger", "single"))
        if trigger not in group.triggers:
            group.triggers.append(trigger)
        group.blocks.append(block)
        if not group.current_name and current_name:
            group.current_name = current_name

    return groups


async def discover_mesh_blocks(timeout: float) -> list[MeshDevice]:
    devices = await BleakScanner.discover(timeout=timeout)
    results: list[MeshDevice] = []
    seen_addresses: set[str] = set()

    for device in devices:
        name = device.name or ""
        if not name.startswith(MESH_PREFIX):
            continue
        if device.address in seen_addresses:
            continue
        seen_addresses.add(device.address)
        results.append(MeshDevice(name=name, address=device.address))

    results.sort(key=lambda item: (item.name, item.address))
    return results


def choose_device(group: AssignmentGroup, devices: list[MeshDevice], used_names: set[str]) -> str:
    kind = group.kind
    expected_prefix = KIND_PREFIX.get(kind, MESH_PREFIX)
    current_name = group.current_name

    preferred = [device for device in devices if device.name.startswith(expected_prefix)]
    fallback = [device for device in devices if device not in preferred]
    ordered = preferred + fallback

    print("")
    print(f"[role] {group.label}")
    print(f"  kind: {kind}")
    if group.triggers:
        print(f"  trigger: {', '.join(group.triggers)}")
    print(f"  current localName: {current_name or '(none)'}")

    available_map: dict[str, MeshDevice] = {}
    for index, device in enumerate(ordered, start=1):
        status = "used" if device.name in used_names else "free"
        print(f"  {index}. {device.name} [{device.address}] ({status})")
        available_map[str(index)] = device

    print("  Enter: keep current value")
    print("  s: skip this role")

    while True:
        answer = input("  select> ").strip()
        if answer == "":
            return current_name
        if answer.lower() == "s":
            return current_name
        device = available_map.get(answer)
        if device is None:
            print("  invalid selection")
            continue
        if device.name in used_names:
            print("  reusing the same physical button for another role")
        return device.name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Register MESH blocks into mesh-ble config")
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("mesh-ble.config.example.json"),
        help="Template config path",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("mesh-ble.config.json"),
        help="Output config path",
    )
    parser.add_argument(
        "--discover-timeout",
        type=float,
        default=8.0,
        help="Discovery timeout in seconds",
    )
    return parser.parse_args()


async def async_main() -> int:
    args = parse_args()
    config = load_config(args.template)
    devices = await discover_mesh_blocks(args.discover_timeout)

    if not devices:
        print("No MESH blocks found. Power on the blocks and rerun.")
        return 1

    print("Discovered MESH blocks:")
    for index, device in enumerate(devices, start=1):
        print(f"  {index}. {device.name} [{device.address}]")

    required_button_groups = len(
        {
            str(block.get("buttonId", "")).strip()
            for block in config.get("blocks", [])
            if str(block.get("kind", "")) == "button" and str(block.get("buttonId", "")).strip()
        }
    )
    discovered_button_devices = len(
        {
            device.name
            for device in devices
            if device.name.startswith(KIND_PREFIX["button"])
        }
    )
    if discovered_button_devices < required_button_groups:
        print("")
        print(
            "Insufficient MESH button blocks for the current Logic PK configuration."
        )
        print(
            f"  required logical button controls: {required_button_groups}"
        )
        print(
            f"  discovered physical button blocks: {discovered_button_devices}"
        )
        print(
            "  current implementation requires separate physical buttons for "
            "redCycle, redConfirm, blueCycle, blueConfirm, refereeControl."
        )
        return 1

    used_names: set[str] = set()
    for group in build_assignment_groups(config):
        selected_name = choose_device(group, devices, used_names)
        if selected_name:
            for block in group.blocks:
                block["localName"] = selected_name
            used_names.add(selected_name)

    errors = validate_button_assignments(config)
    if errors:
        print("")
        print("Invalid button assignment:")
        for error in errors:
            print(f"  - {error}")
        print("Review the button role assignments and rerun.")
        return 1

    save_config(args.out, config)
    print("")
    print(f"Saved {args.out}")
    print("Review serverBaseUrl / trigger values before use.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(async_main()))
