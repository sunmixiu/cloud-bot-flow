#!/usr/bin/env bash
set -eo pipefail

source /opt/ros/humble/setup.bash
set -u
export ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}

work_dir=$(mktemp -d)
talker_pid=""
cleanup() {
  if [[ -n "${talker_pid}" ]]; then
    kill "${talker_pid}" 2>/dev/null || true
    wait "${talker_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

echo "ROS_DISTRO=${ROS_DISTRO}"
echo "demo_nodes_cpp=$(ros2 pkg prefix demo_nodes_cpp)"
python3 -c 'import rclpy; print("rclpy=ok")'

ros2 run demo_nodes_cpp talker >"${work_dir}/talker.log" 2>&1 &
talker_pid=$!
sleep 2
set +e
timeout 7 ros2 run demo_nodes_cpp listener >"${work_dir}/listener.log" 2>&1
listener_status=$?
set -e

if [[ ${listener_status} -ne 0 && ${listener_status} -ne 124 ]]; then
  cat "${work_dir}/listener.log" >&2
  exit "${listener_status}"
fi
if ! grep -q "I heard" "${work_dir}/listener.log"; then
  cat "${work_dir}/talker.log" >&2
  cat "${work_dir}/listener.log" >&2
  echo "ROS 2 listener did not receive a message" >&2
  exit 1
fi

grep "I heard" "${work_dir}/listener.log" | head -n 3
echo "ROS2_PUB_SUB=PASS"
