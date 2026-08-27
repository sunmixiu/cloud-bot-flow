#!/usr/bin/env python3
"""Cloud Bot Flow edge agent.

The agent intentionally depends only on Python's standard library.  It reports
real host/ROS information, polls deployment assignments, and executes immutable
OCI images through the local Docker Engine.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import platform
import re
import shlex
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


VERSION = "0.1.0"
TERMINAL = {"succeeded", "failed", "stopped", "rolled_back"}
SAFE_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


class AgentError(RuntimeError):
    pass


def load_json(path: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    if not path.exists() and default is not None:
        return default
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise AgentError(f"{path} must contain a JSON object")
    return value


def save_secret_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def run(command: list[str], timeout: int = 20, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=check)


def shell(command: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return run(["bash", "-lc", command], timeout=timeout)


def machine_ip() -> str:
    result = run(["hostname", "-I"])
    addresses = [item for item in result.stdout.split() if ":" not in item and not item.startswith("127.")]
    if addresses:
        return addresses[0]
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return str(probe.getsockname()[0])
    finally:
        probe.close()


def os_information() -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, raw = line.split("=", 1)
                values[key] = raw.strip().strip('"')
    except OSError:
        pass
    return {
        "name": values.get("NAME", platform.system()),
        "version": values.get("VERSION_ID", platform.release()),
        "kernel": platform.release(),
    }


def ros_environment(config: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, str]]]:
    setup = str(config.get("ros_setup", "/opt/ros/humble/setup.bash"))
    if not Path(setup).exists():
        return {"distro": "", "status": "not-installed"}, []
    quoted = shlex.quote(setup)
    distro_result = shell(f"source {quoted} && printf '%s' \"$ROS_DISTRO\"")
    distro = distro_result.stdout.strip()
    topics_result = shell(f"source {quoted} && ros2 topic list -t --spin-time 1", timeout=12)
    topics: list[dict[str, str]] = []
    for line in topics_result.stdout.splitlines():
        match = re.match(r"^(\S+)\s+\[(.+)]$", line.strip())
        if match:
            topics.append({"name": match.group(1), "type": match.group(2)})
        elif line.strip().startswith("/"):
            topics.append({"name": line.strip()})
    return {"distro": distro, "status": "ready" if distro else "error"}, topics


def gpu_information() -> dict[str, Any]:
    try:
        result = run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"], timeout=8)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"available": False}
    if result.returncode != 0 or not result.stdout.strip():
        return {"available": False}
    name, _, driver = result.stdout.strip().partition(",")
    return {"available": True, "name": name.strip(), "driver": driver.strip()}


def certificate_information(config: dict[str, Any]) -> dict[str, Any]:
    path = str(config.get("certificate_path", "")).strip()
    if not path or not Path(path).is_file():
        return {"expires_at": config.get("certificate_expires_at")}
    result = run(
        ["openssl", "x509", "-in", path, "-noout", "-enddate", "-fingerprint", "-sha256"],
        timeout=8,
    )
    if result.returncode != 0:
        return {"expires_at": None, "error": result.stderr.strip()}
    expires_at = None
    fingerprint = None
    for line in result.stdout.splitlines():
        if line.startswith("notAfter="):
            parsed = datetime.strptime(line.removeprefix("notAfter="), "%b %d %H:%M:%S %Y %Z")
            expires_at = parsed.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        elif "Fingerprint=" in line:
            fingerprint = line.split("Fingerprint=", 1)[1].replace(":", "").lower()
    return {
        "expires_at": expires_at,
        "sha256_fingerprint": fingerprint,
        "transport": "node-token-with-certificate-metadata",
    }


def probe_registry(endpoint: str) -> dict[str, Any]:
    endpoint = endpoint.strip().rstrip("/")
    url = endpoint if endpoint.startswith(("http://", "https://")) else f"http://{endpoint}"
    request = urllib.request.Request(f"{url}/v2/", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            reachable = 200 <= response.status < 500
            detail = f"HTTP {response.status}"
    except urllib.error.HTTPError as error:
        reachable = error.code in {401, 403}
        detail = f"HTTP {error.code}"
    except Exception as error:  # network failures are reported, not hidden
        reachable = False
        detail = str(error)
    registry_name = endpoint.split("://", 1)[-1]
    return {
        "endpoint": registry_name,
        "reachable": reachable,
        "detail": detail,
        "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def image_digest(image: str) -> str:
    marker = "@sha256:"
    if marker not in image:
        raise AgentError("edge deployment image must use an immutable @sha256 digest")
    digest = "sha256:" + image.split(marker, 1)[1]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise AgentError("edge deployment image has an invalid sha256 digest")
    return digest


class ApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def request(self, method: str, path: str, body: dict[str, Any] | None = None,
                headers: dict[str, str] | None = None) -> dict[str, Any]:
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        request_headers = {"Accept": "application/json"}
        if payload is not None:
            request_headers["Content-Type"] = "application/json; charset=utf-8"
        request_headers.update(headers or {})
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=payload, headers=request_headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise AgentError(f"platform returned HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise AgentError(f"cannot reach platform {self.base_url}: {error.reason}") from error


class EdgeAgent:
    def __init__(self, config_path: Path) -> None:
        self.config_path = config_path
        self.config = load_json(config_path)
        self.state_path = Path(str(self.config.get("state_file", "/var/lib/cloud-bot-flow-edge/credentials.json")))
        self.state = load_json(self.state_path, {})
        self.api = ApiClient(str(self.config["platform_url"]))
        self.interval = max(5, int(self.config.get("poll_interval_seconds", 10)))
        self.docker = str(self.config.get("docker_command", "docker"))
        self.camera_process: subprocess.Popen[str] | None = None

    def inventory(self) -> dict[str, Any]:
        ros, topics = ros_environment(self.config)
        return {
            "agent_id": self.state.get("agent_id") or self.config.get("agent_id"),
            "robot_id": self.config["robot_id"],
            "name": self.config["name"],
            "ip_address": machine_ip(),
            "agent_version": VERSION,
            "architecture": platform.machine(),
            "os": os_information(),
            "ros": ros,
            "gpu": gpu_information(),
            "sensors": list(self.config.get("sensors", [])),
            "topics": topics,
            "registry_endpoints": [probe_registry(str(item)) for item in self.config.get("registry_endpoints", [])],
            "certificate": certificate_information(self.config),
        }

    def register(self) -> None:
        token = os.environ.get("EDGE_BOOTSTRAP_TOKEN", "").strip()
        if not token:
            raise AgentError("first registration requires EDGE_BOOTSTRAP_TOKEN")
        result = self.api.request(
            "POST", "/edge/nodes/register", self.inventory(), {"X-Edge-Bootstrap-Token": token}
        )["result"]
        node = result["node"]
        self.state = {
            "agent_id": node["agent_id"],
            "node_id": node["id"],
            "agent_token": result["agent_token"],
        }
        save_secret_json(self.state_path, self.state)
        print(f"registered node {node['id']} for robot {node['robot_id']}", flush=True)

    @property
    def auth_headers(self) -> dict[str, str]:
        token = str(self.state.get("agent_token", ""))
        if not token:
            raise AgentError("agent credentials are missing; run register first")
        return {"X-Edge-Node-Token": token}

    def heartbeat(self) -> None:
        body = self.inventory()
        body["agent_status"] = "online"
        self.api.request(
            "POST", f"/edge/nodes/{self.state['node_id']}/heartbeat", body, self.auth_headers
        )

    def status(self, deployment_id: str, status: str, message: str,
               extra: dict[str, Any] | None = None) -> None:
        body: dict[str, Any] = {"status": status, "message": message}
        body.update(extra or {})
        self.api.request(
            "POST", f"/edge/deployments/{deployment_id}/status", body, self.auth_headers
        )

    def verify_pulled_image(self, image: str) -> str:
        expected = image_digest(image)
        inspected = run(
            [self.docker, "image", "inspect", "--format", "{{json .RepoDigests}}", image],
            timeout=20,
        )
        if inspected.returncode != 0:
            raise AgentError(inspected.stderr.strip() or "cannot inspect pulled image")
        try:
            repo_digests = json.loads(inspected.stdout)
        except json.JSONDecodeError as error:
            raise AgentError("Docker returned invalid RepoDigests data") from error
        if not isinstance(repo_digests, list) or not any(
            isinstance(item, str) and item.endswith(f"@{expected}") for item in repo_digests
        ):
            raise AgentError(
                f"pulled image digest mismatch: expected {expected}, observed {repo_digests!r}"
            )
        return expected

    def docker_run(self, deployment: dict[str, Any], image: str) -> tuple[str, str]:
        deployment_id = str(deployment["id"])
        name = "cbf-" + re.sub(r"[^a-zA-Z0-9_.-]", "-", deployment_id)[-50:]
        output_dir = Path(str(self.config.get(
            "deployment_data_dir", "/var/lib/cloud-bot-flow-edge/deployments"
        ))) / deployment_id / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        image_user = run(
            [self.docker, "image", "inspect", "--format", "{{.Config.User}}", image], timeout=20
        )
        declared_user = image_user.stdout.strip()
        if declared_user:
            match = re.fullmatch(r"(\d+)(?::(\d+))?", declared_user)
            if not match:
                raise AgentError(
                    f"image declares non-numeric user {declared_user!r}; output ownership cannot be assigned safely"
                )
            uid = int(match.group(1))
            gid = int(match.group(2) or match.group(1))
            os.chown(output_dir, uid, gid)
        os.chmod(output_dir, 0o750)
        run([self.docker, "rm", "-f", name], timeout=30)
        edge_runtime = deployment["algorithm"].get("edge_runtime") or {}
        runtime_kind = str(edge_runtime.get("kind") or "")
        if runtime_kind not in {"batch", "ros2-node", "ros2-snapshot"}:
            raise AgentError("algorithm is missing a supported edge runtime contract")
        command = [
            self.docker, "run", "-d", "--network", "host",
            "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true",
            "--pids-limit", str(int(self.config.get("container_pids_limit", 512))),
            "--memory", str(self.config.get("container_memory_limit", "4g")),
            "--cpus", str(self.config.get("container_cpu_limit", "2.0")),
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
            "--name", name,
            "--label", f"cloud-bot-flow.deployment={deployment_id}",
            "--label", f"cloud-bot-flow.algorithm={deployment['algorithm']['id']}",
            "-e", f"ROS_DOMAIN_ID={int(self.config.get('ros_domain_id', 0))}",
            "-v", f"{output_dir}:/output",
        ]
        if runtime_kind == "ros2-snapshot":
            bridge = dict(self.config.get("camera_bridge") or {})
            snapshot = Path(str(bridge.get(
                "snapshot_path", "/var/lib/cloud-bot-flow-edge/camera/latest.ppm"
            )))
            if not snapshot.is_file():
                raise AgentError("camera snapshot is missing; enable the local camera stream first")
            max_age = max(1.0, float(bridge.get("max_age_seconds", 5.0)))
            age = time.time() - snapshot.stat().st_mtime
            if age > max_age:
                raise AgentError(f"camera snapshot is stale ({age:.1f}s old)")
            command.extend(["-v", f"{snapshot}:/input/image.ppm:ro"])
        for key, value in dict(deployment.get("parameters") or {}).items():
            if SAFE_KEY.fullmatch(str(key)) and isinstance(value, (str, int, float, bool)):
                command.extend(["-e", f"CBF_PARAM_{str(key).upper()}={value}"])
        command.append(image)
        edge_command = deployment["algorithm"].get("edge_command") or []
        if not isinstance(edge_command, list) or not all(isinstance(item, str) for item in edge_command):
            raise AgentError("algorithm edge_command must be an array of strings")
        command.extend(edge_command)
        result = run(command, timeout=90)
        if result.returncode != 0:
            raise AgentError(result.stderr.strip() or result.stdout.strip() or "docker run failed")
        container_id = result.stdout.strip()
        return name, image_digest(image)

    def monitor(self, deployment: dict[str, Any]) -> None:
        deployment_id = str(deployment["id"])
        container = deployment.get("container") or {}
        name = str(container.get("name") or (
            "cbf-" + re.sub(r"[^a-zA-Z0-9_.-]", "-", deployment_id)[-50:]
        ))
        inspected = run(
            [self.docker, "inspect", "--format", "{{json .State}}", name], timeout=20
        )
        if inspected.returncode != 0:
            self.status(deployment_id, "failed", "assigned container no longer exists")
            return
        state = json.loads(inspected.stdout)
        if state.get("Running"):
            return
        exit_code = int(state.get("ExitCode", -1))
        logs = run([self.docker, "logs", "--tail", "30", name], timeout=20)
        detail = (logs.stdout + "\n" + logs.stderr).strip()[-1000:]
        if exit_code == 0:
            self.status(deployment_id, "succeeded", detail or "container completed successfully")
        else:
            self.status(deployment_id, "failed", detail or f"container exited with code {exit_code}")

    def execute(self, deployment: dict[str, Any]) -> None:
        deployment_id = str(deployment["id"])
        desired = deployment.get("desired_state")
        if desired == "stopped":
            name = "cbf-" + re.sub(r"[^a-zA-Z0-9_.-]", "-", deployment_id)[-50:]
            run([self.docker, "rm", "-f", name], timeout=30)
            self.status(deployment_id, "stopped", "container stopped and removed by edge agent")
            return
        if desired == "rollback":
            image = str((deployment.get("previous_release") or {}).get("image") or "")
            if not image:
                self.status(deployment_id, "failed", "rollback image is missing")
                return
            self.status(deployment_id, "pulling", f"pulling rollback image {image}")
            pulled = run([self.docker, "pull", image], timeout=300)
            if pulled.returncode != 0:
                raise AgentError(pulled.stderr.strip() or "rollback image pull failed")
            self.verify_pulled_image(image)
            name, digest = self.docker_run(deployment, image)
            self.status(deployment_id, "running", "rollback completed; previous release is running", {
                "container": {"name": name},
                "observed_image_digest": digest,
                "rollback_completed": True,
            })
            return
        if deployment.get("status") == "running":
            self.monitor(deployment)
            return
        image = str(deployment["algorithm"]["image"])
        self.status(deployment_id, "pulling", f"pulling immutable image {image}")
        pulled = run([self.docker, "pull", image], timeout=300)
        if pulled.returncode != 0:
            raise AgentError(pulled.stderr.strip() or pulled.stdout.strip() or "image pull failed")
        self.verify_pulled_image(image)
        self.status(deployment_id, "starting", "image verified; starting container")
        name, digest = self.docker_run(deployment, image)
        self.status(deployment_id, "running", "container is running on edge node", {
            "container": {"name": name}, "observed_image_digest": digest
        })

    def poll_once(self) -> None:
        self.heartbeat()
        response = self.api.request(
            "GET", f"/edge/nodes/{self.state['node_id']}/assignments", headers=self.auth_headers
        )
        for deployment in response["result"]["data"]:
            if deployment.get("status") in TERMINAL:
                continue
            try:
                self.execute(deployment)
            except Exception as error:
                self.status(str(deployment["id"]), "failed", str(error)[:1000])

    def ensure_camera_bridge(self) -> None:
        bridge = dict(self.config.get("camera_bridge") or {})
        if bridge.get("enabled") is not True:
            return
        if self.camera_process and self.camera_process.poll() is None:
            return
        if not self.state.get("agent_token"):
            raise AgentError("camera bridge requires registered agent credentials")
        setup = Path(str(self.config.get("ros_setup", "/opt/ros/humble/setup.bash")))
        script = Path(__file__).with_name("ros_camera_bridge.py")
        if not setup.is_file() or not script.is_file():
            raise AgentError("camera bridge requires ROS 2 setup and ros_camera_bridge.py")
        command = (
            f"source {shlex.quote(str(setup))} && exec python3 "
            f"{shlex.quote(str(script))} --config {shlex.quote(str(self.config_path))}"
        )
        self.camera_process = subprocess.Popen(["bash", "-lc", command], text=True)

    def stop_camera_bridge(self) -> None:
        if not self.camera_process or self.camera_process.poll() is not None:
            return
        self.camera_process.terminate()
        try:
            self.camera_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.camera_process.kill()
            self.camera_process.wait(timeout=5)

    def serve(self) -> None:
        if not self.state.get("agent_token"):
            self.register()
        try:
            while True:
                try:
                    self.ensure_camera_bridge()
                    self.poll_once()
                except Exception as error:
                    print(f"edge-agent error: {error}", file=sys.stderr, flush=True)
                time.sleep(self.interval)
        finally:
            self.stop_camera_bridge()

    def doctor(self) -> None:
        checks: list[tuple[str, bool, str]] = []
        checks.append((
            "agent privileges",
            os.geteuid() == 0,
            "root is required to assign output ownership and manage Docker containers",
        ))
        try:
            inventory = self.inventory()
            checks.append(("host", True, f"{inventory['ip_address']} / {inventory['architecture']}"))
            checks.append(("ros2", inventory["ros"].get("status") == "ready", str(inventory["ros"])))
            expires_at = str(inventory["certificate"].get("expires_at") or "")
            try:
                expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                certificate_valid = expires > datetime.now(timezone.utc)
            except ValueError:
                certificate_valid = False
            checks.append((
                "agent certificate",
                certificate_valid,
                expires_at or "certificate file or expiry is missing",
            ))
            for registry in inventory["registry_endpoints"]:
                checks.append((
                    f"registry {registry['endpoint']}",
                    registry.get("reachable") is True,
                    str(registry.get("detail") or ""),
                ))
        except Exception as error:
            checks.append(("inventory", False, str(error)))
        try:
            docker = run([self.docker, "version", "--format", "{{.Server.Version}}"], timeout=15)
            checks.append(("docker", docker.returncode == 0, docker.stdout.strip() or docker.stderr.strip()))
        except Exception as error:
            checks.append(("docker", False, str(error)))
        try:
            health = self.api.request("GET", "/health")
            checks.append(("platform", health.get("status") == "ok", self.api.base_url))
        except Exception as error:
            checks.append(("platform", False, str(error)))
        for name, passed, detail in checks:
            print(f"[{'PASS' if passed else 'FAIL'}] {name}: {detail}")
        if not all(item[1] for item in checks):
            raise AgentError("doctor found one or more blocking checks")


def main() -> int:
    parser = argparse.ArgumentParser(description="Cloud Bot Flow edge agent")
    parser.add_argument("--config", default="/etc/cloud-bot-flow-edge/agent.json")
    parser.add_argument("command", choices=["doctor", "register", "once", "serve"], nargs="?", default="serve")
    args = parser.parse_args()
    try:
        agent = EdgeAgent(Path(args.config))
        if args.command == "doctor":
            agent.doctor()
        elif args.command == "register":
            agent.register()
        elif args.command == "once":
            if not agent.state.get("agent_token"):
                agent.register()
            agent.poll_once()
        else:
            agent.serve()
        return 0
    except Exception as error:
        print(f"edge-agent fatal: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
