#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from bleak import BleakClient, BleakScanner

SERVICE_UUID = "72c90001-57a9-4d40-b746-534e22ec9f9e"
INDICATE_UUID = "72c90005-57a9-4d40-b746-534e22ec9f9e"
NOTIFY_UUID = "72c90003-57a9-4d40-b746-534e22ec9f9e"
WRITE_UUID = "72c90004-57a9-4d40-b746-534e22ec9f9e"
FEATURE_COMMAND = bytes([0x00, 0x02, 0x01, 0x03])

BUTTON_TRIGGER_CODE = {"single": 1, "long": 2, "double": 3}
BRIGHTNESS_NOTIFY_MODE = {
    "always": 0x20,
    "brightness_change": 0x08,
    "brightness_change_and_always": 0x28,
}

SCAN_LOCK = asyncio.Lock()


def log(message: str) -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[mesh-ble {timestamp}] {message}", flush=True)


def checksum(payload: list[int]) -> int:
    return sum(payload) % 256


def build_brightness_setmode_command(notify_mode: int, request_id: int = 1) -> bytes:
    payload = [0x01, 0x00, request_id] + [0x00] * 10 + [0x02, 0x02, 0x02, notify_mode]
    payload.append(checksum(payload))
    return bytes(payload)


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config.get("blocks"), list) or not config["blocks"]:
        raise ValueError("config.blocks must be a non-empty array")
    return config


async def post_json(url: str, payload: dict[str, Any], timeout: float = 5.0) -> None:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    def _send() -> None:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()

    await asyncio.to_thread(_send)


def apply_raw_transform(block: dict[str, Any], raw: float) -> float:
    scale = float(block.get("rawScale", 1.0))
    offset = float(block.get("rawOffset", 0.0))
    value = raw * scale + offset
    round_digits = block.get("roundDigits")
    if round_digits is not None:
        value = round(value, int(round_digits))
    if float(value).is_integer():
        return int(value)
    return value


async def discover_mesh_blocks(timeout: float) -> int:
    log(f"Scanning for MESH blocks for {timeout:.1f}s ...")
    devices = await BleakScanner.discover(timeout=timeout)
    mesh_devices = sorted(
        [device for device in devices if (device.name or "").startswith("MESH-100")],
        key=lambda device: device.name or "",
    )
    if not mesh_devices:
        log("No MESH blocks found")
        return 1

    for device in mesh_devices:
        log(f"found {device.name} [{device.address}]")
    return 0


async def find_device(local_name: str, timeout: float):
    async with SCAN_LOCK:
        log(f"Scanning for {local_name} ...")
        return await BleakScanner.find_device_by_filter(
            lambda device, advertisement_data: (
                (advertisement_data.local_name or device.name or "") == local_name
            ),
            timeout=timeout,
        )


class MeshRoleRunner:
    def __init__(self, config: dict[str, Any], blocks: list[dict[str, Any]]):
        self.config = config
        self.blocks = blocks
        primary_block = blocks[0]
        self.role = ",".join(str(block["role"]) for block in blocks)
        self.kind = str(primary_block["kind"])
        self.local_name = str(primary_block["localName"])
        self.server_base_url = config["serverBaseUrl"].rstrip("/")
        self.scan_timeout = float(config.get("scanTimeoutSec", 10))
        self.reconnect_delay = float(config.get("reconnectDelaySec", 5))

    async def run_forever(self) -> None:
        while True:
            try:
                device = await find_device(self.local_name, self.scan_timeout)
                if device is None:
                    log(f"{self.role}: {self.local_name} not found")
                    await asyncio.sleep(self.reconnect_delay)
                    continue

                disconnected = asyncio.Event()

                def _on_disconnect(_: BleakClient) -> None:
                    log(f"{self.role}: disconnected")
                    disconnected.set()

                async with BleakClient(
                    device,
                    disconnected_callback=_on_disconnect,
                    timeout=20.0,
                ) as client:
                    log(f"{self.role}: connected to {self.local_name}")
                    await client.start_notify(INDICATE_UUID, self._on_indicate)
                    await client.start_notify(NOTIFY_UUID, self._on_notify)
                    await client.write_gatt_char(WRITE_UUID, FEATURE_COMMAND, response=True)
                    await self._configure_block(client)
                    log(f"{self.role}: ready")
                    await disconnected.wait()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log(f"{self.role}: error {error}")

            await asyncio.sleep(self.reconnect_delay)

    async def _configure_block(self, client: BleakClient) -> None:
        if self.kind == "brightness":
            notify_mode_name = str(self.blocks[0].get("notifyMode", "always"))
            notify_mode = BRIGHTNESS_NOTIFY_MODE.get(notify_mode_name)
            if notify_mode is None:
                raise ValueError(f"{self.role}: unknown brightness notifyMode {notify_mode_name}")
            command = build_brightness_setmode_command(notify_mode)
            await client.write_gatt_char(WRITE_UUID, command, response=True)
            return

    def _on_indicate(self, _: Any, data: bytearray) -> None:
        payload = list(bytes(data))
        if len(payload) >= 15 and payload[0] == 0 and payload[1] == 2:
            battery = payload[14]
            log(f"{self.role}: battery {battery}%")

    def _on_notify(self, _: Any, data: bytearray) -> None:
        payload = list(bytes(data))
        try:
            if self.kind == "button":
                self._handle_button(payload)
            elif self.kind == "brightness":
                self._handle_brightness(payload)
        except Exception as error:
            log(f"{self.role}: notify handling error {error}")

    def _handle_button(self, payload: list[int]) -> None:
        if len(payload) != 4 or payload[0] != 1 or payload[1] != 0:
            return

        trigger_code = payload[2]
        matched_events: list[dict[str, Any]] = []
        for block in self.blocks:
            expected_trigger = str(block.get("trigger", "single"))
            expected_code = BUTTON_TRIGGER_CODE.get(expected_trigger)
            if expected_code is None:
                raise ValueError(f"{self.role}: unknown trigger {expected_trigger}")
            if trigger_code != expected_code:
                continue

            event = {
                "buttonId": block["buttonId"],
                "action": expected_trigger,
                "timestamp": int(time.time() * 1000),
            }
            matched_events.append(event)
            log(
                f"{self.role}: button matched buttonId={block['buttonId']} trigger={expected_trigger}"
            )

        if not matched_events:
            log(f"{self.role}: button event ignored code={trigger_code}")
            return

        asyncio.create_task(self._post_button_events_in_order(matched_events))

    def _handle_brightness(self, payload: list[int]) -> None:
        if len(payload) < 8 or payload[0] != 1 or payload[1] != 0:
            return

        brightness_raw = 10 * ((payload[7] << 8) + payload[6])
        raw = apply_raw_transform(self.blocks[0], brightness_raw)
        self._post_sensor(raw)

    def _post_sensor(self, raw: float) -> None:
        asyncio.create_task(
            self._post_with_log(
                "/api/mesh/sensor",
                {
                    "team": self.blocks[0].get("team", "goal"),
                    "raw": raw,
                    "timestamp": int(time.time() * 1000),
                },
            )
        )

    async def _post_with_log(self, path: str, payload: dict[str, Any]) -> None:
        url = f"{self.server_base_url}{path}"
        try:
            await post_json(url, payload)
        except urllib.error.HTTPError as error:
            response_body = ""
            try:
                response_body = error.read().decode("utf-8", errors="ignore").strip()
            except Exception:
                response_body = ""
            suffix = f" body={response_body}" if response_body else ""
            log(f"{self.role}: POST {path} failed {error.code}{suffix}")
        except Exception as error:
            log(f"{self.role}: POST {path} failed {error}")

    async def _post_button_events_in_order(self, events: list[dict[str, Any]]) -> None:
        for event in events:
            await self._post_with_log("/api/mesh/button", event)


async def run_bridge(config_path: Path) -> int:
    config = load_config(config_path)
    brightness_blocks = [
        block for block in config["blocks"] if str(block.get("kind", "")) == "brightness"
    ]
    configured_button_ids = {
        str(block.get("buttonId", ""))
        for block in config["blocks"]
        if str(block.get("kind", "")) == "button"
    }
    required_button_ids = [
        "redCycle",
        "redConfirm",
        "blueCycle",
        "blueConfirm",
        "refereeControl",
    ]
    missing_button_ids = sorted(button_id for button_id in required_button_ids if button_id not in configured_button_ids)

    if missing_button_ids:
        raise ValueError(
            "Current Logic PK implementation requires five button roles: "
            f"{', '.join(required_button_ids)}. Missing: {', '.join(missing_button_ids)}. "
            "Run `npm run ble:register` to regenerate mesh-ble.config.json."
        )

    if len(brightness_blocks) > 1:
        roles = ", ".join(str(block.get("role", "?")) for block in brightness_blocks)
        raise ValueError(
            "Current Logic PK implementation supports only one brightness sensor block "
            f"(configured: {roles})"
        )

    blocks_by_name: dict[str, list[dict[str, Any]]] = {}
    for block in config["blocks"]:
        blocks_by_name.setdefault(block["localName"], []).append(block)

    for local_name, grouped_blocks in blocks_by_name.items():
        kinds = {str(block["kind"]) for block in grouped_blocks}
        if len(kinds) > 1:
            raise ValueError(
                f"Conflicting kinds for localName {local_name}: {', '.join(sorted(kinds))}"
            )

        kind = next(iter(kinds))
        if len(grouped_blocks) > 1 and kind != "button":
            roles = ", ".join(str(block["role"]) for block in grouped_blocks)
            raise ValueError(
                f"Duplicate localName is only supported for button blocks: {local_name} ({roles})"
            )

        if kind == "button":
            button_ids = sorted(
                {
                    str(block.get("buttonId", "")).strip()
                    for block in grouped_blocks
                    if str(block.get("buttonId", "")).strip()
                }
            )
            if len(button_ids) > 1:
                raise ValueError(
                    "Current Logic PK implementation requires separate physical buttons for each logical control. "
                    f"localName {local_name} is shared by: {', '.join(button_ids)}"
                )

    unique_button_local_names = {
        str(block.get("localName", "")).strip()
        for block in config["blocks"]
        if str(block.get("kind", "")) == "button" and str(block.get("localName", "")).strip()
    }
    if len(unique_button_local_names) < len(required_button_ids):
        raise ValueError(
            "Current Logic PK implementation requires five distinct physical button blocks for "
            f"{', '.join(required_button_ids)}. "
            f"Configured unique button blocks: {len(unique_button_local_names)}"
        )

    tasks = [
        asyncio.create_task(MeshRoleRunner(config, grouped_blocks).run_forever())
        for grouped_blocks in blocks_by_name.values()
    ]
    await asyncio.gather(*tasks)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Direct BLE bridge for Sony MESH blocks")
    parser.add_argument("--config", type=Path, help="Path to mesh-ble config JSON")
    parser.add_argument(
        "--discover",
        action="store_true",
        help="Scan nearby MESH blocks and print their local names",
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
    if args.discover:
        return await discover_mesh_blocks(args.discover_timeout)
    if not args.config:
        raise SystemExit("--config is required unless --discover is used")
    return await run_bridge(args.config)


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(async_main()))
    except KeyboardInterrupt:
        log("Stopped by user")
        sys.exit(130)
