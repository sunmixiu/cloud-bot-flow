#!/usr/bin/env python3
"""Publish browser camera frames as a real ROS 2 sensor_msgs/Image topic."""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Image


def load_object(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} must contain a JSON object")
    return value


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class BrowserCameraBridge(Node):
    def __init__(self, config: dict, state: dict) -> None:
        super().__init__("cloud_bot_browser_camera_bridge")
        bridge = dict(config.get("camera_bridge") or {})
        self.base_url = str(config["platform_url"]).rstrip("/")
        self.node_id = str(state["node_id"])
        self.token = str(state["agent_token"])
        self.topic = str(bridge.get("topic", "/camera/image"))
        self.frame_id = str(bridge.get("frame_id", "browser_local_camera"))
        self.snapshot_path = Path(str(
            bridge.get("snapshot_path", "/var/lib/cloud-bot-flow-edge/camera/latest.ppm")
        ))
        self.max_age_seconds = max(1.0, float(bridge.get("max_age_seconds", 5.0)))
        publish_hz = min(10.0, max(0.5, float(bridge.get("publish_hz", 4.0))))
        self.publisher = self.create_publisher(Image, self.topic, qos_profile_sensor_data)
        self.last_sequence = 0
        self.last_received_at: datetime | None = None
        self.last_error = ""
        self.create_timer(1.0 / publish_hz, self.poll)
        self.get_logger().info(
            f"browser camera bridge ready: platform node {self.node_id} -> {self.topic}"
        )

    def fetch(self) -> dict | None:
        request = urllib.request.Request(
            f"{self.base_url}/edge/nodes/{self.node_id}/camera/frame",
            headers={"Accept": "application/json", "X-Edge-Node-Token": self.token},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.loads(response.read().decode("utf-8"))["result"]
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise

    def write_snapshot(self, width: int, height: int, raw: bytes) -> None:
        self.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.snapshot_path.with_suffix(self.snapshot_path.suffix + ".tmp")
        with temporary.open("wb") as handle:
            handle.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
            handle.write(raw)
        os.chmod(temporary, 0o644)
        temporary.replace(self.snapshot_path)

    def poll(self) -> None:
        try:
            frame = self.fetch()
            if not frame:
                return
            sequence = int(frame["sequence"])
            received_at = parse_time(str(frame["received_at"]))
            # The platform intentionally keeps camera frames only in memory. Its
            # sequence therefore restarts at 1 after a backend restart, while this
            # bridge can remain alive. Use the server receive timestamp as the
            # cross-restart cursor instead of permanently rejecting lower numbers.
            if self.last_received_at is not None and received_at <= self.last_received_at:
                return
            age = (datetime.now(timezone.utc) - received_at).total_seconds()
            if age > self.max_age_seconds:
                return
            width = int(frame["width"])
            height = int(frame["height"])
            step = int(frame["step"])
            if str(frame["encoding"]) != "rgb8" or step != width * 3:
                raise RuntimeError("platform returned an unsupported camera encoding")
            raw = base64.b64decode(str(frame["data_base64"]), validate=True)
            if len(raw) != step * height:
                raise RuntimeError("platform camera frame length does not match its dimensions")

            message = Image()
            message.header.stamp = self.get_clock().now().to_msg()
            message.header.frame_id = self.frame_id
            message.height = height
            message.width = width
            message.encoding = "rgb8"
            message.is_bigendian = 0
            message.step = step
            message.data = raw
            self.publisher.publish(message)
            self.write_snapshot(width, height, raw)
            self.last_sequence = sequence
            self.last_received_at = received_at
            self.last_error = ""
        except Exception as error:
            detail = str(error)
            if detail != self.last_error:
                self.get_logger().error(f"camera bridge poll failed: {detail}")
                self.last_error = detail


def main() -> int:
    parser = argparse.ArgumentParser(description="Cloud Bot Flow browser-to-ROS camera bridge")
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config_path = Path(args.config)
    config = load_object(config_path)
    state_path = Path(str(config.get(
        "state_file", "/var/lib/cloud-bot-flow-edge/credentials.json"
    )))
    state = load_object(state_path)
    rclpy.init()
    node = BrowserCameraBridge(config, state)
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
