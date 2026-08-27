import { createHash, randomBytes, randomUUID } from "node:crypto";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "stopped", "rolled_back"]);
const AGENT_STATUSES = new Set(["pulling", "starting", "running", "succeeded", "failed", "stopped", "rolled_back"]);
const ONLINE_TTL_MS = Number(process.env.EDGE_NODE_ONLINE_TTL_MS || 45_000);
const EDGE_REGISTRY_PUBLIC_ENDPOINT = String(process.env.EDGE_REGISTRY_PUBLIC_ENDPOINT || "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const knownLinuxAmd64Digests = new Set([
  "sha256:6628e568e0c563a50e9fc9c201c57d983fcda2f11703ad93ea8ba49259794f02",
  "sha256:3f5bfdbabe283952d4d9579edbefe37242f56b3b479f0bd22282e251fa445846",
  "sha256:64ac7fa30ec420f3bc8e27f18ea635787e0b092d7c75ca6732601c5575097f5e",
  "sha256:c51cd3535a94e2a6320bfeb2fdc60fa6b4d1c4f070fded1004a92435da1c0b7f",
  "sha256:6b04505876a4ae88a9d39e0048807cde856babba3aec6099448041b0a4392d65"
]);

const now = () => new Date().toISOString();
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const asText = (value) => String(value ?? "").trim();
const asList = (value) => Array.isArray(value) ? value : [];

function normalizeArchitecture(value) {
  const architecture = asText(value).toLowerCase();
  if (["x86_64", "x64", "amd64"].includes(architecture)) return "amd64";
  if (["aarch64", "arm64", "arm64v8"].includes(architecture)) return "arm64";
  return architecture || "unknown";
}

function imageRegistry(image) {
  const first = asText(image).split("/")[0].toLowerCase();
  return first.includes(".") || first.includes(":") || first === "localhost" ? first : "docker.io";
}

function edgeImageFor(algorithm) {
  const image = asText(algorithm?.image);
  const registry = imageRegistry(image);
  const host = registry.split(":")[0];
  if (EDGE_REGISTRY_PUBLIC_ENDPOINT && ["localhost", "127.0.0.1", "::1"].includes(host)) {
    return `${EDGE_REGISTRY_PUBLIC_ENDPOINT}${image.slice(registry.length)}`;
  }
  return image;
}

function imagePlatforms(algorithm) {
  const declared = asList(algorithm.platforms).map(normalizeArchitecture).filter(Boolean);
  if (declared.length) return declared;
  const digest = algorithm.image_digest || asText(algorithm.image).split("@")[1];
  return knownLinuxAmd64Digests.has(digest) ? ["amd64"] : [];
}

function nodeOnline(node) {
  const lastSeen = Date.parse(node.last_seen_at || "");
  return node.agent_status !== "disabled" && Number.isFinite(lastSeen) && Date.now() - lastSeen <= ONLINE_TTL_MS;
}

function publicNode(node) {
  const { token_hash: _tokenHash, ...safe } = node;
  return {
    ...safe,
    architecture: normalizeArchitecture(node.architecture),
    online: nodeOnline(node),
    agent_status: nodeOnline(node) ? (node.agent_status || "online") : "offline"
  };
}

function publicDeployment(deployment) {
  return { ...deployment, rollback_available: Boolean(deployment.previous_release?.image) };
}

function topicMap(node) {
  return new Map(asList(node.topics).map((topic) => {
    if (typeof topic === "string") return [topic, { name: topic }];
    return [asText(topic?.name), topic];
  }));
}

function compatibilityFor(node, algorithm, pipeline) {
  const blockers = [];
  const warnings = [];
  const checks = [];
  const block = (code, message) => blockers.push({ code, message });
  const pass = (code, message) => checks.push({ code, message, passed: true });

  if (nodeOnline(node)) pass("node-online", "机器人 Agent 心跳正常");
  else block("node-offline", `机器人已离线：最后心跳 ${node.last_seen_at || "从未上报"}`);
  if (!algorithm) {
    block("algorithm-not-found", "算法不存在或已从交付目录移除");
    return { runnable: false, blockers, warnings, checks };
  }
  if (algorithm.status === "quarantined") block("algorithm-quarantined", "算法镜像仍处于隔离状态，不能下发到真机");
  else if (algorithm.status !== "ready") block("algorithm-not-ready", `算法状态为 ${algorithm.status || "unknown"}，尚未达到可部署状态`);
  else pass("algorithm-ready", "算法已通过发布资格检查");

  const image = edgeImageFor(algorithm);
  if (image.includes("@sha256:")) pass("immutable-image", "镜像已使用不可变 SHA-256 摘要");
  else block("mutable-image", "镜像没有固定 SHA-256 Digest，禁止下发");

  const nodeArch = normalizeArchitecture(node.architecture);
  const platforms = imagePlatforms(algorithm);
  if (!platforms.length) block("platform-unknown", "镜像没有经过 CPU 架构验证");
  else if (!platforms.includes(nodeArch)) block("architecture-mismatch", `镜像支持 ${platforms.join("/")}，机器人是 ${nodeArch}`);
  else pass("architecture-compatible", `CPU 架构匹配：${nodeArch}`);

  const osName = asText(node.os?.name || node.os).toLowerCase();
  if (!osName.includes("linux") && osName !== "ubuntu") block("os-incompatible", `镜像要求 Linux，机器人上报 ${osName || "未知系统"}`);
  else pass("os-compatible", `操作系统可运行 Linux 容器：${node.os?.name || node.os}`);

  const requiredTopics = asList(algorithm.intended_runtime_inputs).length
    ? asList(algorithm.intended_runtime_inputs)
    : asList(algorithm.inputs).filter((item) => asText(item).startsWith("/"));
  const edgeRuntime = algorithm.edge_runtime && typeof algorithm.edge_runtime === "object"
    ? algorithm.edge_runtime
    : null;
  const edgeRuntimeKind = asText(edgeRuntime?.kind);
  if (!edgeRuntime || !["batch", "ros2-node", "ros2-snapshot"].includes(edgeRuntimeKind)) {
    block(
      "edge-contract-missing",
      "算法尚未声明可审计的边缘运行合同；仅有 Docker 镜像和 Pipeline 不等于能在机器人上运行"
    );
  } else if (requiredTopics.length && !["ros2-node", "ros2-snapshot"].includes(edgeRuntimeKind)) {
    block(
      "ros2-adapter-missing",
      `算法声明了 ${requiredTopics.length} 个 ROS 2 Topic 输入，但镜像没有声明 ros2-node 适配器`
    );
  } else {
    pass(
      "edge-contract-ready",
      edgeRuntimeKind === "ros2-node"
        ? "镜像已声明 ROS 2 节点运行合同"
        : edgeRuntimeKind === "ros2-snapshot"
          ? "镜像已声明 ROS 2 相机快照适配合同"
          : "镜像已声明边缘批处理运行合同"
    );
  }
  if (edgeRuntimeKind === "ros2-snapshot") {
    const receivedAt = Date.parse(node.camera_stream?.received_at || "");
    const cameraActive = Number.isFinite(receivedAt) && Date.now() - receivedAt < 5_000;
    if (!cameraActive) {
      block("camera-frame-missing", "本机摄像头尚未启用，或最近 5 秒没有收到真实画面");
    } else {
      pass("camera-frame-ready", `摄像头真实帧已接入：${node.camera_stream.width}x${node.camera_stream.height}`);
    }
  }
  const topics = topicMap(node);
  const missingTopics = requiredTopics.filter((name) => !topics.has(name));
  if (missingTopics.length) block("topics-missing", `缺少 Topic：${missingTopics.join("、")}`);
  else if (requiredTopics.length) pass("topics-ready", `所需 ${requiredTopics.length} 个输入 Topic 均已发现`);
  if (requiredTopics.length && !asText(node.ros?.distro || node.ros2_version)) block("ros2-unknown", "机器人没有上报 ROS 2 版本");

  if (asText(algorithm.runtime).toLowerCase().includes("cuda") && !node.gpu?.available) {
    block("gpu-missing", "该算法需要 CUDA GPU，但机器人未上报可用 GPU");
  }

  const registry = imageRegistry(image);
  if (["localhost", "127.0.0.1", "::1"].includes(registry.split(":")[0])) {
    block("registry-loopback", `镜像地址 ${registry} 是平台本机回环地址，机器人无法从自己的 localhost 拉取该镜像`);
  } else {
    const registryStatus = asList(node.registry_endpoints).find((item) => asText(item.endpoint).toLowerCase() === registry);
    if (!registryStatus?.reachable) block("registry-unreachable", `机器人 Agent 尚未确认能够访问镜像仓库 ${registry}`);
    else pass("registry-reachable", `机器人可以访问镜像仓库 ${registry}`);
  }

  const expiresAt = Date.parse(node.certificate?.expires_at || node.certificate_expires_at || "");
  if (!Number.isFinite(expiresAt)) block("certificate-unknown", "Agent 没有上报证书有效期");
  else if (expiresAt <= Date.now()) block("certificate-expired", "Agent 证书已经过期");
  else {
    pass("certificate-valid", `Agent 证书有效至 ${new Date(expiresAt).toISOString()}`);
    if (expiresAt - Date.now() < 7 * 86_400_000) warnings.push({ code: "certificate-expiring", message: "Agent 证书将在 7 天内过期" });
  }

  if (!pipeline?.workflow_manifest) block("pipeline-unbound", "算法没有绑定受控 Pipeline");
  else pass("pipeline-bound", "算法已绑定受控 Pipeline");
  return { runnable: blockers.length === 0, blockers, warnings, checks, evaluated_at: now() };
}

function validateRegistration(body, robots) {
  const required = [["robot_id", body.robot_id], ["name", body.name], ["ip_address", body.ip_address], ["architecture", body.architecture], ["os", body.os], ["ros", body.ros], ["sensors", body.sensors], ["topics", body.topics]];
  const missing = required.filter(([, value]) => value === undefined || value === null || value === "").map(([key]) => key);
  if (missing.length) return `缺少登记字段：${missing.join(", ")}`;
  if (!robots.some((robot) => String(robot.id) === String(body.robot_id))) return "robot_id 不属于平台已有机器人资源";
  if (!Array.isArray(body.sensors) || !Array.isArray(body.topics)) return "sensors 和 topics 必须是数组";
  return "";
}

export function createEdgeService({ store, persistStore, readBody, sendJson, sendError }) {
  store.edgeNodes ??= [];
  store.edgeDeployments ??= [];
  // Camera frames are transient runtime data. Never persist raw images in data.json.
  const cameraFrames = new Map();
  const findNode = (id) => store.edgeNodes.find((node) => String(node.id) === String(id));
  const findDeployment = (id) => store.edgeDeployments.find((item) => String(item.id) === String(id));
  const agentToken = (request) => {
    const authorization = asText(request.headers.authorization);
    return asText(request.headers["x-edge-node-token"] || (authorization.startsWith("Edge ") ? authorization.slice(5) : ""));
  };
  const authorizeNode = (request, node) => Boolean(node && agentToken(request) && sha256(agentToken(request)) === node.token_hash);

  async function handleAgentRequest(request, response, pathname) {
    if (pathname === "/edge/nodes/register" && request.method === "POST") {
      const configuredToken = asText(process.env.EDGE_AGENT_BOOTSTRAP_TOKEN);
      if (!configuredToken) {
        sendError(response, 503, "平台未配置 EDGE_AGENT_BOOTSTRAP_TOKEN，拒绝匿名登记机器人");
        return true;
      }
      if (asText(request.headers["x-edge-bootstrap-token"]) !== configuredToken) {
        sendError(response, 401, "Edge Agent bootstrap token 无效");
        return true;
      }
      const body = await readBody(request);
      const invalid = validateRegistration(body, store.robots);
      if (invalid) {
        sendError(response, 400, invalid);
        return true;
      }
      const token = randomBytes(32).toString("base64url");
      const timestamp = now();
      const existing = store.edgeNodes.find((node) => (body.agent_id && node.agent_id === body.agent_id) || String(node.robot_id) === String(body.robot_id));
      const node = {
        ...(existing || {}),
        id: existing?.id || `edge-node-${randomUUID()}`,
        agent_id: asText(body.agent_id) || existing?.agent_id || `agent-${randomUUID()}`,
        robot_id: body.robot_id,
        name: asText(body.name),
        ip_address: asText(body.ip_address),
        observed_ip: asText(request.socket.remoteAddress),
        agent_version: asText(body.agent_version) || "unknown",
        agent_status: "online",
        architecture: normalizeArchitecture(body.architecture),
        os: typeof body.os === "string" ? { name: body.os } : body.os,
        ros: typeof body.ros === "string" ? { distro: body.ros } : body.ros,
        gpu: body.gpu || { available: false },
        sensors: body.sensors,
        topics: body.topics,
        registry_endpoints: asList(body.registry_endpoints),
        current_deployment: existing?.current_deployment || null,
        certificate: body.certificate || { expires_at: body.certificate_expires_at || null },
        token_hash: sha256(token),
        registered_at: existing?.registered_at || timestamp,
        last_seen_at: timestamp,
        updated_at: timestamp
      };
      if (existing) Object.assign(existing, node);
      else store.edgeNodes.push(node);
      await persistStore();
      sendJson(response, existing ? 200 : 201, { result: { node: publicNode(node), agent_token: token, heartbeat_interval_seconds: Math.max(5, Math.floor(ONLINE_TTL_MS / 3000)) } });
      return true;
    }

    const heartbeat = pathname.match(/^\/edge\/nodes\/([^/]+)\/heartbeat$/);
    if (heartbeat && request.method === "POST") {
      const node = findNode(decodeURIComponent(heartbeat[1]));
      if (!authorizeNode(request, node)) {
        sendError(response, 401, "Edge Agent 凭据无效");
        return true;
      }
      const body = await readBody(request);
      const timestamp = now();
      Object.assign(node, {
        agent_status: asText(body.agent_status) || "online",
        ip_address: asText(body.ip_address) || node.ip_address,
        observed_ip: asText(request.socket.remoteAddress),
        architecture: normalizeArchitecture(body.architecture || node.architecture),
        os: body.os || node.os,
        ros: body.ros || node.ros,
        gpu: body.gpu || node.gpu,
        sensors: Array.isArray(body.sensors) ? body.sensors : node.sensors,
        topics: Array.isArray(body.topics) ? body.topics : node.topics,
        registry_endpoints: Array.isArray(body.registry_endpoints) ? body.registry_endpoints : node.registry_endpoints,
        certificate: body.certificate || node.certificate,
        last_seen_at: timestamp,
        updated_at: timestamp
      });
      await persistStore();
      sendJson(response, 200, { result: { accepted: true, server_time: timestamp, next_heartbeat_seconds: Math.max(5, Math.floor(ONLINE_TTL_MS / 3000)) } });
      return true;
    }

    const cameraFrame = pathname.match(/^\/edge\/nodes\/([^/]+)\/camera\/frame$/);
    if (cameraFrame && request.method === "GET") {
      const node = findNode(decodeURIComponent(cameraFrame[1]));
      if (!authorizeNode(request, node)) {
        sendError(response, 401, "Edge Agent 凭据无效");
        return true;
      }
      const frame = cameraFrames.get(node.id);
      if (!frame) {
        sendError(response, 404, "网页尚未向该机器人提供摄像头帧");
        return true;
      }
      sendJson(response, 200, { result: frame });
      return true;
    }

    const assignments = pathname.match(/^\/edge\/nodes\/([^/]+)\/assignments$/);
    if (assignments && request.method === "GET") {
      const node = findNode(decodeURIComponent(assignments[1]));
      if (!authorizeNode(request, node)) {
        sendError(response, 401, "Edge Agent 凭据无效");
        return true;
      }
      const pending = store.edgeDeployments.filter((item) => item.node_id === node.id && !TERMINAL_STATUSES.has(item.status));
      sendJson(response, 200, { result: { data: pending.map(publicDeployment), count: pending.length } });
      return true;
    }

    const statusMatch = pathname.match(/^\/edge\/deployments\/([^/]+)\/status$/);
    if (statusMatch && request.method === "POST") {
      const deployment = findDeployment(decodeURIComponent(statusMatch[1]));
      const node = deployment ? findNode(deployment.node_id) : null;
      if (!deployment) {
        sendError(response, 404, "边缘部署不存在");
        return true;
      }
      if (!authorizeNode(request, node)) {
        sendError(response, 401, "Edge Agent 凭据无效");
        return true;
      }
      const body = await readBody(request);
      if (!AGENT_STATUSES.has(body.status)) {
        sendError(response, 400, "不支持的 Agent 部署状态");
        return true;
      }
      deployment.status = body.status;
      deployment.message = asText(body.message);
      deployment.container = body.container || deployment.container || null;
      deployment.observed_image_digest = asText(body.observed_image_digest) || deployment.observed_image_digest || null;
      deployment.updated_at = now();
      deployment.revision = Number(deployment.revision || 0) + 1;
      if (body.rollback_completed === true && body.status === "running" && deployment.previous_release?.image) {
        deployment.desired_state = "running";
        deployment.rollback_completed_at = deployment.updated_at;
        deployment.effective_release = {
          image: deployment.previous_release.image,
          version: deployment.previous_release.version || null,
          deployment_id: deployment.previous_release.deployment_id || null
        };
      }
      if (body.status === "running" && !deployment.started_at) deployment.started_at = deployment.updated_at;
      if (TERMINAL_STATUSES.has(body.status)) deployment.finished_at = deployment.updated_at;
      if (["running", "succeeded"].includes(body.status)) {
        node.current_deployment = { id: deployment.id, algorithm_id: deployment.algorithm.id, algorithm_name: deployment.algorithm.name, image: deployment.effective_release?.image || deployment.algorithm.image, version: deployment.effective_release?.version || deployment.algorithm.version, status: body.status, updated_at: deployment.updated_at };
      } else if (["stopped", "failed"].includes(body.status) && node.current_deployment?.id === deployment.id) {
        node.current_deployment.status = body.status;
        node.current_deployment.updated_at = deployment.updated_at;
      }
      node.last_seen_at = deployment.updated_at;
      node.agent_status = "online";
      node.updated_at = deployment.updated_at;
      await persistStore();
      sendJson(response, 200, { result: publicDeployment(deployment) });
      return true;
    }
    return false;
  }

  async function handlePlatformRequest(request, response, pathname, url) {
    if (pathname === "/edge/nodes" && request.method === "GET") {
      const algorithmId = url.searchParams.get("algorithm_id");
      const algorithm = algorithmId ? store.simulationAlgorithms.find((item) => String(item.id) === String(algorithmId)) : null;
      const pipeline = algorithm ? store.pipelines.find((item) => asList(item.algorithm_ids).some((id) => String(id) === String(algorithm.id))) : null;
      const data = store.edgeNodes.map((node) => ({ ...publicNode(node), ...(algorithmId ? { compatibility: compatibilityFor(node, algorithm, pipeline) } : {}) }));
      sendJson(response, 200, { result: { data, count: data.length } });
      return true;
    }

    const healthMatch = pathname.match(/^\/edge\/nodes\/([^/]+)\/health$/);
    if (healthMatch && request.method === "GET") {
      const node = findNode(decodeURIComponent(healthMatch[1]));
      if (!node) {
        sendError(response, 404, "机器人 Edge 节点不存在");
        return true;
      }
      const algorithmId = url.searchParams.get("algorithm_id");
      const algorithm = algorithmId ? store.simulationAlgorithms.find((item) => String(item.id) === String(algorithmId)) : null;
      const pipeline = algorithm ? store.pipelines.find((item) => asList(item.algorithm_ids).some((id) => String(id) === String(algorithm.id))) : null;
      sendJson(response, 200, { result: { node: publicNode(node), compatibility: algorithmId ? compatibilityFor(node, algorithm, pipeline) : null } });
      return true;
    }

    const cameraFrame = pathname.match(/^\/edge\/nodes\/([^/]+)\/camera\/frame$/);
    if (cameraFrame && request.method === "POST") {
      const node = findNode(decodeURIComponent(cameraFrame[1]));
      if (!node) {
        sendError(response, 404, "机器人 Edge 节点不存在");
        return true;
      }
      const body = await readBody(request);
      const width = Number(body.width);
      const height = Number(body.height);
      const step = Number(body.step);
      const encoding = asText(body.encoding);
      const dataBase64 = asText(body.data_base64);
      if (
        encoding !== "rgb8" ||
        !Number.isInteger(width) || width < 16 || width > 640 ||
        !Number.isInteger(height) || height < 16 || height > 480 ||
        step !== width * 3 ||
        !dataBase64
      ) {
        sendError(response, 400, "摄像头帧必须是最大 640x480 的紧凑 rgb8 数据");
        return true;
      }
      let raw;
      try {
        raw = Buffer.from(dataBase64, "base64");
      } catch {
        sendError(response, 400, "摄像头帧 Base64 无效");
        return true;
      }
      if (raw.length !== step * height) {
        sendError(response, 400, `摄像头帧长度不匹配：应为 ${step * height}，实际 ${raw.length}`);
        return true;
      }
      const previous = cameraFrames.get(node.id);
      const frame = {
        sequence: Number(previous?.sequence || 0) + 1,
        encoding,
        width,
        height,
        step,
        data_base64: dataBase64,
        captured_at: asText(body.captured_at) || now(),
        received_at: now(),
        source: "browser-local-camera"
      };
      cameraFrames.set(node.id, frame);
      node.camera_stream = {
        active: true,
        sequence: frame.sequence,
        width,
        height,
        encoding,
        source: frame.source,
        received_at: frame.received_at
      };
      sendJson(response, 202, {
        result: {
          accepted: true,
          sequence: frame.sequence,
          received_at: frame.received_at
        }
      });
      return true;
    }

    const cameraStatus = pathname.match(/^\/edge\/nodes\/([^/]+)\/camera\/status$/);
    if (cameraStatus && request.method === "GET") {
      const node = findNode(decodeURIComponent(cameraStatus[1]));
      if (!node) {
        sendError(response, 404, "机器人 Edge 节点不存在");
        return true;
      }
      const frame = cameraFrames.get(node.id);
      sendJson(response, 200, {
        result: {
          active: Boolean(frame && Date.now() - Date.parse(frame.received_at) < 5_000),
          sequence: frame?.sequence || 0,
          width: frame?.width || null,
          height: frame?.height || null,
          received_at: frame?.received_at || null,
          source: frame?.source || null
        }
      });
      return true;
    }

    if (pathname === "/edge/deployments" && request.method === "POST") {
      const body = await readBody(request);
      const node = findNode(body.node_id);
      const algorithm = store.simulationAlgorithms.find((item) => String(item.id) === String(body.algorithm_id));
      const pipeline = store.pipelines.find((item) => String(item.id) === String(body.pipeline_id) && asList(item.algorithm_ids).some((id) => String(id) === String(body.algorithm_id)));
      if (!node || !algorithm || !pipeline) {
        sendError(response, 400, "node_id、algorithm_id 或 pipeline_id 无效");
        return true;
      }
      const compatibility = compatibilityFor(node, algorithm, pipeline);
      if (!compatibility.runnable) {
        sendJson(response, 409, { message: "机器人不满足该算法的部署条件", status: 409, result: { compatibility } });
        return true;
      }
      const previous = store.edgeDeployments.slice().reverse().find((item) => item.node_id === node.id && String(item.algorithm?.id) === String(algorithm.id) && ["running", "succeeded", "stopped"].includes(item.status));
      const timestamp = now();
      const deployment = {
        id: `edge-deploy-${randomUUID()}`,
        node_id: node.id,
        robot_id: node.robot_id,
        site_code: asText(body.site_code) || "UNASSIGNED",
        algorithm: { id: algorithm.id, name: algorithm.name, version: algorithm.version, image: edgeImageFor(algorithm), source_image: algorithm.image, image_digest: algorithm.image_digest || asText(algorithm.image).split("@")[1] || null, platforms: imagePlatforms(algorithm), inputs: algorithm.inputs || [], outputs: algorithm.outputs || [], edge_command: asList(algorithm.edge_command), edge_runtime: algorithm.edge_runtime || null },
        pipeline: { id: pipeline.id, name: pipeline.name },
        parameters: body.parameters && typeof body.parameters === "object" ? body.parameters : {},
        desired_state: "running",
        status: "queued",
        message: "等待机器人 Edge Agent 领取部署任务",
        compatibility,
        previous_release: previous ? { deployment_id: previous.id, image: previous.algorithm.image, version: previous.algorithm.version } : null,
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp
      };
      store.edgeDeployments.push(deployment);
      await persistStore();
      sendJson(response, 201, { result: publicDeployment(deployment) });
      return true;
    }

    const deploymentMatch = pathname.match(/^\/edge\/deployments\/([^/]+)$/);
    if (deploymentMatch && request.method === "GET") {
      const deployment = findDeployment(decodeURIComponent(deploymentMatch[1]));
      if (!deployment) sendError(response, 404, "边缘部署不存在");
      else sendJson(response, 200, { result: publicDeployment(deployment) });
      return true;
    }

    const actionMatch = pathname.match(/^\/edge\/deployments\/([^/]+)\/(stop|rollback)$/);
    if (actionMatch && request.method === "POST") {
      const deployment = findDeployment(decodeURIComponent(actionMatch[1]));
      if (!deployment) {
        sendError(response, 404, "边缘部署不存在");
        return true;
      }
      const action = actionMatch[2];
      if (action === "stop") {
        if (TERMINAL_STATUSES.has(deployment.status)) {
          sendError(response, 409, `部署已处于终态 ${deployment.status}，不能重复停止`);
          return true;
        }
        deployment.desired_state = "stopped";
        deployment.status = "stop_requested";
        deployment.message = "平台已请求停止，等待机器人 Agent 执行";
      } else {
        if (!deployment.previous_release?.image) {
          sendError(response, 409, "没有可回滚的上一版本");
          return true;
        }
        deployment.desired_state = "rollback";
        deployment.status = "rollback_requested";
        deployment.message = `等待机器人 Agent 回滚到 ${deployment.previous_release.version || deployment.previous_release.image}`;
      }
      deployment.revision = Number(deployment.revision || 0) + 1;
      deployment.updated_at = now();
      await persistStore();
      sendJson(response, 202, { result: publicDeployment(deployment) });
      return true;
    }
    return false;
  }

  return { handleAgentRequest, handlePlatformRequest };
}
