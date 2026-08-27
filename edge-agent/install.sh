#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "run this installer with sudo" >&2
  exit 1
fi

SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 0755 /opt/cloud-bot-flow-edge /etc/cloud-bot-flow-edge
install -d -m 0700 /var/lib/cloud-bot-flow-edge
install -d -m 0755 /var/lib/cloud-bot-flow-edge/ros-log
install -m 0755 "${SOURCE_DIR}/cloud_bot_edge_agent.py" /opt/cloud-bot-flow-edge/cloud_bot_edge_agent.py
install -m 0755 "${SOURCE_DIR}/ros_camera_bridge.py" /opt/cloud-bot-flow-edge/ros_camera_bridge.py
install -m 0644 "${SOURCE_DIR}/cloud-bot-edge-agent.service" /etc/systemd/system/cloud-bot-edge-agent.service

if [[ ! -f /etc/cloud-bot-flow-edge/agent.json ]]; then
  install -m 0600 "${SOURCE_DIR}/agent.example.json" /etc/cloud-bot-flow-edge/agent.json
fi

systemctl daemon-reload
echo "Agent files installed. Edit /etc/cloud-bot-flow-edge/agent.json, register once with"
echo "/opt/cloud-bot-flow-edge/cloud_bot_edge_agent.py doctor"
echo "EDGE_BOOTSTRAP_TOKEN='<token>' /opt/cloud-bot-flow-edge/cloud_bot_edge_agent.py register"
echo "then run: systemctl enable --now cloud-bot-edge-agent"
