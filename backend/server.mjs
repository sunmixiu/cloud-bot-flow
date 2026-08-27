import http from "node:http";
import { copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  artifactStore,
  cubeStudio,
  platformConfiguration
} from "./platform-services.mjs";
import { kubernetesClient } from "./kubernetes-service.mjs";
import { createEdgeService } from "./edge-service.mjs";

const currentFile = fileURLToPath(import.meta.url);
const backendDir = path.dirname(currentFile);
const projectDir = path.resolve(backendDir, "..");
const workspaceDir = path.resolve(projectDir, "..");
const staticDir = path.join(projectDir, "dist");
const dataFile = process.env.CLOUD_BOT_FLOW_DATA_FILE
  ? path.resolve(process.env.CLOUD_BOT_FLOW_DATA_FILE)
  : path.join(backendDir, "data.json");
const dataBackupFile = `${dataFile}.bak`;
const dataTempFile = `${dataFile}.tmp`;
const catalogFile = path.join(backendDir, "open-source-catalog.json");
const port = Number(process.env.CLOUD_BOT_FLOW_PORT || process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

const collectionRoutes = {
  images_modelview: "algorithms",
  project_modelview: "projects",
  dataset_modelview: "datasets",
  pipeline_modelview: "pipelines",
  robot_modelview: "robots",
  code_repository: "codeModules",
  simulation_algorithm: "simulationAlgorithms"
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

let store = JSON.parse(await readFile(dataFile, "utf8"));
const openSourceCatalog = JSON.parse(await readFile(catalogFile, "utf8"));
let persistQueue = Promise.resolve();

store.codeModules ??= [
  {
    id: 1,
    name: "激光雷达 SLAM",
    module: "感知与定位",
    language: "C++ / ROS 2",
    version: "2.1.0",
    author: "张工",
    repository_url: "ssh://git.local/robot/slam.git",
    branch: "main",
    description: "点云预处理、定位、回环检测与地图构建模块",
    visibility: "private",
    status: "verified",
    updated_at: "2026-07-23T08:30:00.000Z"
  },
  {
    id: 2,
    name: "视觉目标检测",
    module: "机器视觉",
    language: "Python / PyTorch",
    version: "1.8.3",
    author: "李工",
    repository_url: "ssh://git.local/robot/vision-detector.git",
    branch: "release/1.8",
    description: "工业目标检测、缺陷识别与位姿估计模块",
    visibility: "private",
    status: "verified",
    updated_at: "2026-07-22T06:10:00.000Z"
  },
  {
    id: 3,
    name: "机械臂轨迹控制",
    module: "运动规划与控制",
    language: "C++ / MoveIt 2",
    version: "3.0.1",
    author: "王工",
    repository_url: "ssh://git.local/robot/arm-controller.git",
    branch: "main",
    description: "逆运动学、轨迹平滑、碰撞检测和末端控制",
    visibility: "private",
    status: "testing",
    updated_at: "2026-07-24T02:20:00.000Z"
  },
  {
    id: 4,
    name: "多机器人任务分配",
    module: "任务规划",
    language: "Python",
    version: "0.9.0",
    author: "陈工",
    repository_url: "ssh://git.local/robot/task-allocation.git",
    branch: "develop",
    description: "多机器人任务拆解、调度与冲突消解",
    visibility: "private",
    status: "developing",
    updated_at: "2026-07-24T05:00:00.000Z"
  }
];

store.simulationAlgorithms ??= [
  {
    id: 1,
    code_module_id: 1,
    name: "SLAM导航算法",
    module: "感知与定位",
    version: "2.1.0",
    image: "harbor.local/robot/slam:2.1.0",
    command: "ros2 launch robot_slam simulation.launch.py",
    runtime: "ROS 2 Humble",
    inputs: ["/scan", "/imu"],
    outputs: ["/map", "/tf", "/odom"],
    description: "在仿真环境中完成实时定位和地图构建",
    status: "ready",
    color: "#3b82f6"
  },
  {
    id: 2,
    code_module_id: 2,
    name: "视觉识别算法",
    module: "机器视觉",
    version: "1.8.3",
    image: "harbor.local/robot/vision:1.8.3",
    command: "python3 /workspace/detect.py --ros",
    runtime: "CUDA 12 / ROS 2",
    inputs: ["/camera/color"],
    outputs: ["/detections", "/target_pose"],
    description: "识别工件、障碍物并输出目标位姿",
    status: "ready",
    color: "#8b5cf6"
  },
  {
    id: 3,
    code_module_id: 3,
    name: "路径规划算法",
    module: "运动规划与控制",
    version: "1.5.2",
    image: "harbor.local/robot/path-planner:1.5.2",
    command: "ros2 launch path_planner planner.launch.py",
    runtime: "ROS 2 Humble",
    inputs: ["/map", "/target_pose"],
    outputs: ["/planned_path"],
    description: "根据地图、目标位姿和障碍物生成安全路径",
    status: "ready",
    color: "#06b6d4"
  },
  {
    id: 4,
    code_module_id: 3,
    name: "机械臂控制",
    module: "运动规划与控制",
    version: "3.0.1",
    image: "harbor.local/robot/arm-control:3.0.1",
    command: "ros2 launch arm_control moveit_sim.launch.py",
    runtime: "MoveIt 2 / ROS 2",
    inputs: ["/planned_path", "/joint_states"],
    outputs: ["/joint_trajectory", "/controller_state"],
    description: "驱动机械臂完成轨迹跟踪和末端操作",
    status: "ready",
    color: "#f59e0b"
  }
];

store.simulationRuns ??= [];
store.imageBuilds ??= [];
store.registryImages ??= [];
store.registryRepositories ??= [
  {
    id: "repo-local-compatible",
    name: "本地镜像仓库配置",
    server: "harbor.local/robot/",
    hubsecret: "robot-registry",
    provider: "local-compatible",
    status: "metadata-only",
    created_at: "2026-07-24T00:00:00.000Z"
  }
];
store.pipelineRuns ??= [];
store.artifacts ??= [];
store.edgeNodes ??= [];
store.edgeDeployments ??= [];

for (const artifact of store.artifacts) {
  const run = store.simulationRuns.find((item) => item.id === artifact.run_id);
  if (run?.execution_mode === "cube-studio-argo" && artifact.storage?.provider === "minio") {
    artifact.storage.provider = "cube-minio";
  }
}

const bootedAt = new Date().toISOString();
for (const run of store.simulationRuns) {
  if (run.status === "running" || run.status === "paused") {
    if (run.execution_mode === "cube-studio-argo" && run.remote_workflow?.name) continue;
    run.status = "interrupted";
    run.finished_at = bootedAt;
    run.updated_at = bootedAt;
    run.interruption_reason = "服务重启后未发现可恢复的执行器";
  }
}

const upsertCatalogItems = (collection, items) => {
  const catalogKeys = new Set(items.map((item) => item.catalog_key));
  return [
    ...collection.filter((item) => !catalogKeys.has(item.catalog_key)),
    ...items
  ];
};

const catalogCodeModules = openSourceCatalog.sources.map((source) => ({
  id: source.id,
  catalog_key: source.catalog_key,
  name: source.name,
  module: source.module,
  language: source.language,
  version: source.version,
  author: source.author,
  repository_url: source.repository_url,
  branch: source.branch,
  verified_commit: source.verified_commit,
  license: source.license,
  description: source.description,
  visibility: "public",
  source: "github",
  status: "verified",
  updated_at: openSourceCatalog.verified_at
}));

const catalogSimulationAlgorithms = openSourceCatalog.sources.map((source) => ({
  id: source.id,
  code_module_id: source.id,
  catalog_key: source.catalog_key,
  name: source.name,
  module: source.module,
  version: source.version,
  repository_url: source.repository_url,
  branch: source.branch,
  verified_commit: source.verified_commit,
  license: source.license,
  image: source.simulation.image,
  image_status: "build-required",
  command: source.simulation.command,
  runtime: source.simulation.runtime,
  inputs: source.simulation.inputs,
  outputs: source.simulation.outputs,
  input_types: source.simulation.input_types,
  output_types: source.simulation.output_types,
  description: source.description,
  status: "verified-source",
  execution_adapter: "browser-digital-twin",
  color: source.simulation.color,
  verified_at: openSourceCatalog.verified_at
}));

const catalogWorkflowAlgorithms = openSourceCatalog.sources.map((source) => ({
  id: source.id,
  catalog_key: source.catalog_key,
  name: source.name,
  describe: source.description,
  created_on: openSourceCatalog.verified_at,
  changed_on: openSourceCatalog.verified_at,
  entrypoint: source.simulation.command,
  dockerfile: "Dockerfile.catalog",
  gitpath: source.repository_url,
  images_url: source.simulation.image,
  image_status: "build-required",
  license: source.license,
  verified_commit: source.verified_commit,
  project: store.projects[0]
}));

store.codeModules = upsertCatalogItems(store.codeModules, catalogCodeModules);
store.simulationAlgorithms = upsertCatalogItems(
  store.simulationAlgorithms,
  catalogSimulationAlgorithms
);
store.algorithms = upsertCatalogItems(store.algorithms, catalogWorkflowAlgorithms);

const physicsPickPlaceAsset = {
  id: 120,
  code_module_id: 120,
  catalog_key: "bullet-panda-pick-place",
  name: "Bullet Panda 机械臂物理取放",
  module: "刚体动力学与操作",
  language: "Python / Bullet C++",
  version: "1.0.0",
  author: "cloud-bot-flow / Bullet Physics",
  repository_url: "https://github.com/bulletphysics/bullet3",
  branch: "master",
  verified_commit: "63c4d67e337017f9d8b298c900e9aabdb69296e7",
  license: "Zlib",
  image: "localhost:5001/cloud-bot-flow/physics-pick-place@sha256:3f5bfdbabe283952d4d9579edbefe37242f56b3b479f0bd22282e251fa445846",
  image_digest: "sha256:3f5bfdbabe283952d4d9579edbefe37242f56b3b479f0bd22282e251fa445846",
  image_status: "verified",
  command: "python -m physics_sim.run --output /output --seed 20260818",
  runtime: "PyBullet 3.2.7 / Python 3.11",
  inputs: [],
  outputs: ["simulation-run.json", "trajectory.json", "preview.png", "SHA256SUMS.json"],
  description: "在 Bullet 240 Hz 刚体动力学中驱动 Franka Panda 完成接近、抓取、搬运、放置和撤离，输出关节轨迹、接触检查、相机帧和可复核断言。",
  status: "ready",
  execution_adapter: "cube-studio-argo-workflow",
  evidence_kind: "physics-simulation",
  workflow_manifest: "algorithm/physics-pick-place/workflow/closed-loop.yaml",
  color: "#22d3ee",
  verified_at: "2026-08-18T00:00:00.000Z"
};

store.codeModules = upsertCatalogItems(store.codeModules, [{
  ...physicsPickPlaceAsset,
  visibility: "public",
  source: "github",
  status: "verified",
  updated_at: physicsPickPlaceAsset.verified_at
}]);
store.simulationAlgorithms = upsertCatalogItems(
  store.simulationAlgorithms,
  [physicsPickPlaceAsset]
);
store.algorithms = upsertCatalogItems(store.algorithms, [{
  id: physicsPickPlaceAsset.id,
  catalog_key: physicsPickPlaceAsset.catalog_key,
  name: physicsPickPlaceAsset.name,
  describe: physicsPickPlaceAsset.description,
  created_on: physicsPickPlaceAsset.verified_at,
  changed_on: physicsPickPlaceAsset.verified_at,
  entrypoint: physicsPickPlaceAsset.command,
  dockerfile: "algorithm/physics-pick-place/Dockerfile",
  gitpath: physicsPickPlaceAsset.repository_url,
  images_url: physicsPickPlaceAsset.image,
  image_status: "verified",
  license: physicsPickPlaceAsset.license,
  verified_commit: physicsPickPlaceAsset.verified_commit,
  project: store.projects[0]
}]);
store.pipelines = upsertCatalogItems(store.pipelines, [{
  id: 6,
  catalog_key: "physics-pick-place-pipeline",
  name: "机械臂物理取放闭环",
  pipeline_url: "<span>机械臂物理取放闭环</span>",
  description: "Bullet 物理求解 → 轨迹与接触断言 → MinIO 证据归档 → WebGL 遥测回放",
  creator: "cloud-bot-flow",
  modified: "2026-08-18 12:00",
  project: store.projects[0],
  algorithm_ids: [physicsPickPlaceAsset.id],
  workflow_manifest: physicsPickPlaceAsset.workflow_manifest,
  runtime: "Argo Workflows / Cube Studio / PyBullet",
  image: physicsPickPlaceAsset.image,
  image_digest: physicsPickPlaceAsset.image_digest,
  status: "verified"
}]);

const retailDigitalTwinAsset = {
  id: 121,
  code_module_id: 121,
  catalog_key: "retail-digital-twin-baseline",
  name: "便利店点云数字孪生闭环",
  module: "感认知 / 导航 / 上半身",
  language: "Python",
  version: "1.0.1",
  author: "cloud-bot-flow",
  repository_url: "https://github.com/durancexuan/cloud-bot-flow",
  branch: "workspace",
  verified_commit: "workspace-20260818",
  license: "Internal",
  image: "localhost:5001/cloud-bot-flow/retail-digital-twin@sha256:64ac7fa30ec420f3bc8e27f18ea635787e0b092d7c75ca6732601c5575097f5e",
  image_digest: "sha256:64ac7fa30ec420f3bc8e27f18ea635787e0b092d7c75ca6732601c5575097f5e",
  image_status: "verified",
  command: "python -m retail_twin.run --output /output --seed 20260818",
  edge_command: ["--output", "/output", "--seed", "20260818"],
  edge_runtime: {
    kind: "batch",
    network: "host",
    output_contract: "artifact-directory",
    description: "在机器人边缘计算机执行一次性场景处理并将证据写入 /output；不宣称订阅 ROS 2 Topic 或控制执行器。"
  },
  runtime: "Python 3.12 / OCI / Argo Workflows",
  inputs: [],
  outputs: [
    "retail-run.json",
    "retail-store.pcd",
    "retail-store.obj",
    "navigation-trajectory.json",
    "preview.png",
    "SHA256SUMS.json"
  ],
  description: "真实执行点云体素化 Mesh、几何识别、占据栅格、任务图、A* 导航、差速轨迹和传统解析 IK；VLA 未配置时明确阻断，不伪造推理结果。",
  status: "ready",
  execution_adapter: "cube-studio-argo-workflow",
  evidence_kind: "retail-digital-twin",
  workflow_manifest: "algorithm/retail-digital-twin/workflow/closed-loop.yaml",
  color: "#10b981",
  verified_at: "2026-08-18T00:00:00.000Z"
};

store.codeModules = upsertCatalogItems(store.codeModules, [{
  ...retailDigitalTwinAsset,
  visibility: "private",
  source: "workspace",
  status: "verified",
  updated_at: retailDigitalTwinAsset.verified_at
}]);
store.simulationAlgorithms = upsertCatalogItems(
  store.simulationAlgorithms,
  [retailDigitalTwinAsset]
);

// The barcode image remains a black-box batch executable. On edge nodes it is
// fed by the audited browser-camera -> ROS 2 -> immutable snapshot adapter.
const retailBarcodeEdgeAsset = store.simulationAlgorithms.find(
  (algorithm) => Number(algorithm.id) === 107
);
if (retailBarcodeEdgeAsset) {
  retailBarcodeEdgeAsset.edge_runtime = {
    kind: "ros2-snapshot",
    input_topic: "/camera/image",
    input_mount_path: "/input/image.ppm",
    output_contract: "result-json",
    description: "消费 ROS 2 相机桥接器生成的新鲜快照；容器只读挂载输入，不直接获得摄像头设备权限。"
  };
  retailBarcodeEdgeAsset.edge_command = [
    "--input", "/input/image.ppm",
    "--output", "/output/result.json",
    "--require-detection"
  ];
}
store.algorithms = upsertCatalogItems(store.algorithms, [{
  id: retailDigitalTwinAsset.id,
  catalog_key: retailDigitalTwinAsset.catalog_key,
  name: retailDigitalTwinAsset.name,
  describe: retailDigitalTwinAsset.description,
  created_on: retailDigitalTwinAsset.verified_at,
  changed_on: retailDigitalTwinAsset.verified_at,
  entrypoint: retailDigitalTwinAsset.command,
  dockerfile: "algorithm/retail-digital-twin/Dockerfile",
  gitpath: retailDigitalTwinAsset.repository_url,
  images_url: retailDigitalTwinAsset.image,
  image_status: "verified",
  license: retailDigitalTwinAsset.license,
  verified_commit: retailDigitalTwinAsset.verified_commit,
  project: store.projects[0]
}]);
store.pipelines = upsertCatalogItems(store.pipelines, [{
  id: 7,
  catalog_key: "retail-digital-twin-pipeline",
  name: "便利店点云重建与作业闭环",
  pipeline_url: "<span>便利店点云重建与作业闭环</span>",
  description: "点云重建 → 场景识别 → 任务拆解 → 导航避障 → 传统抓取可达性 → 证据归档",
  creator: "cloud-bot-flow",
  modified: "2026-08-18 13:00",
  project: store.projects[0],
  algorithm_ids: [retailDigitalTwinAsset.id],
  workflow_manifest: retailDigitalTwinAsset.workflow_manifest,
  runtime: "Argo Workflows / Cube Studio / Python",
  image: retailDigitalTwinAsset.image,
  image_digest: retailDigitalTwinAsset.image_digest,
  status: "verified"
}]);

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Edge-Bootstrap-Token, X-Edge-Node-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, statusCode, payload) {
  setCommonHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { message, status: statusCode });
}

async function readBody(request) {
  const chunks = [];
  let length = 0;

  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) {
      throw new Error("请求内容过大");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function persistStore() {
  // 轨迹帧以 MinIO 证据包为事实源，不在状态索引中重复持久化。
  const snapshot = `${JSON.stringify(
    store,
    (key, value) => key === "keyframes" && Array.isArray(value) ? undefined : value,
    2
  )}\n`;
  const writeSnapshot = async () => {
    await writeFile(dataTempFile, snapshot, "utf8");
    JSON.parse(await readFile(dataTempFile, "utf8"));
    try {
      await copyFile(dataFile, dataBackupFile);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
    }
    await rename(dataTempFile, dataFile);
  };
  persistQueue = persistQueue.then(writeSnapshot, writeSnapshot);
  return persistQueue;
}

function findItem(collection, id) {
  return collection.find((item) => String(item.id) === String(id));
}

function nextId(collection) {
  const numericIds = collection
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id));
  return numericIds.length === 0 ? 1 : Math.max(...numericIds) + 1;
}

function normalizeRobot(robot) {
  return {
    ...robot,
    chassis: robot.chassis ?? robot.chassisType ?? "",
    actuator: robot.actuator ?? robot.endEffectorType ?? "",
    working_range: robot.working_range ?? robot.workRange ?? "",
    loading: robot.loading ?? robot.payload ?? ""
  };
}

function normalizePipeline(pipeline) {
  const visibleName = String(pipeline.pipeline_url || "")
    .replace(/<[^>]*>/g, "")
    .trim();
  return {
    ...pipeline,
    name: pipeline.name || visibleName || "新任务",
    pipeline_url: pipeline.pipeline_url || `<span>${pipeline.name || "新任务"}</span>`,
    creator: pipeline.creator || "demo",
    modified: pipeline.modified || new Date().toLocaleString("zh-CN"),
    project: pipeline.project || store.projects[0]
  };
}

function normalizeAlgorithm(algorithm) {
  const now = new Date().toISOString();
  return {
    describe: "本地添加的算法",
    created_on: now,
    changed_on: now,
    entrypoint: "",
    dockerfile: "Dockerfile",
    gitpath: "",
    project: store.projects[0],
    ...algorithm,
    name: algorithm.name || algorithm.images_url || "新算法",
    changed_on: now
  };
}

function normalizeDataset(dataset) {
  return {
    icon_html: "dataset",
    version: "1.0",
    label_html: `<span>${dataset.name || "新数据集"}</span>`,
    describe: "",
    owner: "demo",
    path_html: "",
    download_url_html: "",
    ...dataset
  };
}

function normalizeCodeModule(module) {
  return {
    module: "其他",
    language: "Python",
    version: "0.1.0",
    author: "当前用户",
    repository_url: "",
    branch: "main",
    description: "",
    visibility: "private",
    status: "testing",
    updated_at: new Date().toISOString(),
    ...module
  };
}

function normalizeSimulationAlgorithm(algorithm) {
  return {
    module: "其他",
    version: "0.1.0",
    image: "local/algorithm:latest",
    command: "",
    runtime: "Docker",
    inputs: [],
    outputs: [],
    description: "",
    status: "ready",
    color: "#3b82f6",
    ...algorithm
  };
}

function isValidImageReference(value) {
  const image = String(value || "");
  return (
    image.length <= 240 &&
    /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+:[A-Za-z0-9_.-]+$/.test(image) &&
    !image.includes("..") &&
    !image.includes("//")
  );
}

function buildImageManifest(build, codeModule) {
  const manifest = {
    schema_version: "robot-algorithm-image/v1",
    source: {
      repository_url: codeModule.repository_url,
      ref: build.source_ref,
      verified_commit: codeModule.verified_commit || null
    },
    image: {
      base: build.base_image,
      target: build.target_image
    },
    build: {
      dockerfile: build.dockerfile,
      resource_cpu: build.resource_cpu,
      resource_memory: build.resource_memory
    }
  };
  return {
    ...manifest,
    sha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
  };
}

function ensureRegistryImage(build) {
  const existing = store.registryImages.find((image) => image.build_id === build.id);
  if (existing) return existing;

  const digest = `sha256:${createHash("sha256")
    .update(`${build.build_manifest.sha256}:${build.target_image}`)
    .digest("hex")}`;
  const now = new Date().toISOString();
  const image = {
    id: `image-${randomUUID()}`,
    name: build.code_module_name,
    target_image: build.target_image,
    digest,
    immutable_ref: `${build.target_image.replace(/:[^/:]+$/, "")}@${digest}`,
    source_ref: build.source_ref,
    build_id: build.id,
    code_module_id: build.code_module_id,
    provider: build.provider,
    evidence_level:
      build.provider === "cube-studio" ? "registry-submission" : "local-metadata-rehearsal",
    runtime_verified: false,
    status: "ready",
    created_at: now
  };
  store.registryImages.push(image);

  const simulationAlgorithm = store.simulationAlgorithms.find(
    (algorithm) => String(algorithm.code_module_id) === String(build.code_module_id)
  );
  if (simulationAlgorithm) {
    simulationAlgorithm.image = build.target_image;
    simulationAlgorithm.image_digest = digest;
    simulationAlgorithm.image_status = "built";
    simulationAlgorithm.status = "ready";
    simulationAlgorithm.updated_at = now;
  }
  const workflowAlgorithm = store.algorithms.find(
    (algorithm) =>
      String(algorithm.gitpath || "") === String(build.repository_url || "") ||
      String(algorithm.name || "") === String(build.code_module_name || "")
  );
  if (workflowAlgorithm) {
    workflowAlgorithm.images_url = build.target_image;
    workflowAlgorithm.image_digest = digest;
    workflowAlgorithm.image_status = "built";
    workflowAlgorithm.changed_on = now;
  }
  return image;
}

function updateLocalImageBuild(build, nowMs) {
  if (build.provider !== "local-compatible") return false;
  if (["succeeded", "failed", "cancelled"].includes(build.status)) return false;
  const elapsed = Math.max(0, nowMs - Date.parse(build.submitted_at));
  const previous = `${build.status}:${build.progress}`;
  if (elapsed < 1200) {
    build.status = "queued";
    build.phase = "等待构建执行器";
    build.progress = 5;
  } else if (elapsed < 8500) {
    build.status = "building";
    build.phase =
      elapsed < 3200
        ? "拉取源码与基础镜像"
        : elapsed < 6100
          ? "执行 Dockerfile 构建"
          : "登记镜像摘要";
    build.progress = Math.min(94, Math.round(10 + ((elapsed - 1200) / 7300) * 84));
  } else {
    build.status = "succeeded";
    build.phase = "镜像元数据已登记";
    build.progress = 100;
    build.finished_at ||= new Date(nowMs).toISOString();
    build.registry_image_id = ensureRegistryImage(build).id;
  }
  build.updated_at = new Date(nowMs).toISOString();
  return previous !== `${build.status}:${build.progress}`;
}

function pipelineTaskState(progress, start, end) {
  if (progress >= end) return "succeeded";
  if (progress >= start) return "running";
  return "queued";
}

async function updateLocalPipelineRun(run, nowMs) {
  if (run.provider !== "local-compatible") return false;
  if (["succeeded", "failed", "cancelled"].includes(run.status)) return false;
  const elapsed = Math.max(0, nowMs - Date.parse(run.submitted_at));
  const duration = Number(run.duration_ms || 14000);
  const previous = `${run.status}:${run.progress}:${run.artifact_id || ""}`;
  const progress = Math.min(100, Math.round((elapsed / duration) * 100));
  run.progress = progress;
  run.status = progress >= 100 ? "succeeded" : elapsed < 900 ? "queued" : "running";
  run.phase =
    progress < 15
      ? "解析 Pipeline DAG"
      : progress < 35
        ? "校验镜像摘要与输入契约"
        : progress < 75
          ? "执行算法容器任务"
          : progress < 100
            ? "归档运行产物"
            : "Pipeline 完成";
  const ranges = [
    [0, 15],
    [15, 35],
    [35, 75],
    [75, 92],
    [92, 100]
  ];
  run.tasks = run.tasks.map((task, index) => ({
    ...task,
    status: pipelineTaskState(progress, ranges[index][0], ranges[index][1])
  }));
  run.updated_at = new Date(nowMs).toISOString();

  if (progress >= 100 && !run.artifact_id && !run.artifact_pending) {
    run.artifact_pending = true;
    const output = {
      schema_version: "robot-pipeline-result/v1",
      run_id: run.id,
      pipeline_id: run.pipeline_id,
      pipeline_name: run.pipeline_name,
      images: run.images.map((image) => ({
        id: image.id,
        immutable_ref: image.immutable_ref,
        digest: image.digest
      })),
      execution: {
        provider: run.provider,
        evidence_level: run.evidence_level,
        started_at: run.started_at,
        finished_at: new Date(nowMs).toISOString(),
        result: "succeeded"
      },
      outputs: {
        simulation_manifest: `runs/${run.id}/simulation-manifest.json`,
        metrics: {
          contract_checks: run.images.length,
          completed_tasks: run.tasks.length
        }
      }
    };
    const objectKey = `pipeline-runs/${run.id}/result.json`;
    const storage = await artifactStore.putJson(objectKey, output);
    const artifact = {
      id: `artifact-${randomUUID()}`,
      run_id: run.id,
      name: `${run.pipeline_name}-result.json`,
      content_type: "application/json",
      storage,
      created_at: new Date(nowMs).toISOString()
    };
    store.artifacts.push(artifact);
    run.artifact_id = artifact.id;
    run.artifact_pending = false;
    run.finished_at = new Date(nowMs).toISOString();
  }
  return previous !== `${run.status}:${run.progress}:${run.artifact_id || ""}`;
}

async function refreshPlatformJobs() {
  const nowMs = Date.now();
  let changed = false;
  for (const build of store.imageBuilds) {
    changed = updateLocalImageBuild(build, nowMs) || changed;
  }
  for (const run of store.pipelineRuns) {
    changed = (await updateLocalPipelineRun(run, nowMs)) || changed;
  }
  if (changed) await persistStore();
}

const sceneProfiles = {
  warehouse: {
    id: "warehouse",
    version: "1.1.0",
    label: "仓储移动机器人",
    compatible_robot_kinds: ["mobile_base"],
    topics: {
      "/scan": "sensor_msgs/msg/LaserScan",
      "/tf": "tf2_msgs/msg/TFMessage",
      "/imu": "sensor_msgs/msg/Imu",
      "/imu/data": "sensor_msgs/msg/Imu",
      "/odom": "nav_msgs/msg/Odometry",
      "/odometry/raw": "nav_msgs/msg/Odometry",
      "/camera/color": "sensor_msgs/msg/Image",
      "/camera/image_raw": "sensor_msgs/msg/Image",
      "/camera/camera_info": "sensor_msgs/msg/CameraInfo",
      "/goal_pose": "geometry_msgs/msg/PoseStamped"
    }
  },
  "manipulation-cell": {
    id: "manipulation-cell",
    version: "1.0.0",
    label: "机械臂操作单元",
    compatible_robot_kinds: ["manipulator"],
    topics: {
      "/tf": "tf2_msgs/msg/TFMessage",
      "/joint_states": "sensor_msgs/msg/JointState",
      "/planning_scene": "moveit_msgs/msg/PlanningScene",
      "/motion_plan_request": "moveit_msgs/msg/MotionPlanRequest",
      "/task_goal": "moveit_task_constructor_msgs/msg/TaskDescription",
      "/planning_environment": "tesseract_msgs/msg/Environment",
      "/program": "tesseract_msgs/msg/CompositeInstruction",
      "/task_request": "std_msgs/msg/String",
      "/behavior_events": "diagnostic_msgs/msg/DiagnosticArray",
      "/camera/image_raw": "sensor_msgs/msg/Image",
      "/camera/camera_info": "sensor_msgs/msg/CameraInfo",
      "/camera/depth/points": "sensor_msgs/msg/PointCloud2",
      "/reference_cloud": "sensor_msgs/msg/PointCloud2"
    }
  },
  "rmf-building": {
    id: "rmf-building",
    version: "1.0.0",
    label: "RMF 多机器人楼宇",
    compatible_robot_kinds: ["fleet"],
    minimum_robots: 2,
    topics: {
      "/fleet_states": "rmf_fleet_msgs/msg/FleetState",
      "/task_request": "rmf_task_msgs/msg/ApiRequest",
      "/tf": "tf2_msgs/msg/TFMessage"
    }
  },
  "retail-store": {
    id: "retail-store",
    version: "1.0.0",
    label: "便利店货架与收银区",
    compatible_robot_kinds: ["mobile_base"],
    topics: {
      "/scan": "sensor_msgs/msg/LaserScan",
      "/tf": "tf2_msgs/msg/TFMessage",
      "/imu/data": "sensor_msgs/msg/Imu",
      "/odom": "nav_msgs/msg/Odometry",
      "/camera/image": "sensor_msgs/msg/Image",
      "/camera/color": "sensor_msgs/msg/Image",
      "/camera/depth/image": "sensor_msgs/msg/Image",
      "/camera/image_raw": "sensor_msgs/msg/Image",
      "/camera/camera_info": "sensor_msgs/msg/CameraInfo",
      "/goal_pose": "geometry_msgs/msg/PoseStamped"
    }
  }
};

const catalogRequirements = {
  "slam-toolbox": {
    robot_kinds: ["mobile_base"],
    capabilities: ["lidar"],
    scenes: ["warehouse"]
  },
  navigation2: {
    robot_kinds: ["mobile_base"],
    capabilities: ["navigation"],
    scenes: ["warehouse"]
  },
  "apriltag-ros2": {
    robot_kinds: ["mobile_base", "manipulator"],
    capabilities: ["camera"],
    scenes: ["warehouse", "manipulation-cell"]
  },
  moveit2: {
    robot_kinds: ["manipulator"],
    capabilities: ["manipulation"],
    scenes: ["manipulation-cell"]
  },
  "robot-localization": {
    robot_kinds: ["mobile_base"],
    capabilities: ["imu", "odometry"],
    scenes: ["warehouse"]
  },
  "open-rmf-free-fleet": {
    robot_kinds: ["fleet"],
    capabilities: ["fleet_orchestrator"],
    scenes: ["rmf-building"],
    minimum_robots: 2
  },
  "opencv-retail-dnn": {
    robot_kinds: ["mobile_base"],
    capabilities: ["camera"],
    scenes: ["retail-store", "warehouse"]
  },
  "bytetrack-retail": {
    robot_kinds: ["mobile_base"],
    capabilities: ["camera"],
    scenes: ["retail-store"]
  },
  "paddleocr-shelf-label": {
    robot_kinds: ["mobile_base"],
    capabilities: ["camera"],
    scenes: ["retail-store", "warehouse"]
  },
  "moveit-task-constructor": {
    robot_kinds: ["manipulator"],
    capabilities: ["manipulation"],
    scenes: ["manipulation-cell"]
  },
  "tesseract-planning": {
    robot_kinds: ["manipulator"],
    capabilities: ["manipulation"],
    scenes: ["manipulation-cell"]
  },
  "behaviortree-cpp": {
    robot_kinds: ["mobile_base", "manipulator"],
    capabilities: [],
    scenes: ["warehouse", "retail-store", "manipulation-cell"]
  },
  "open3d-registration": {
    robot_kinds: ["manipulator"],
    capabilities: ["camera"],
    scenes: ["manipulation-cell"]
  },
  "rtabmap-3d-slam": {
    robot_kinds: ["mobile_base"],
    capabilities: ["camera", "odometry"],
    scenes: ["warehouse", "retail-store"]
  },
  "bullet-panda-pick-place": {
    robot_kinds: ["manipulator"],
    capabilities: ["manipulation"],
    scenes: ["manipulation-cell"]
  },
  "retail-digital-twin-baseline": {
    robot_kinds: ["mobile_base"],
    capabilities: ["camera", "navigation", "odometry"],
    scenes: ["retail-store"]
  }
};

function getRobotProfile(robot) {
  const model = String(robot?.model || "").toUpperCase();
  if (model.includes("ARM") || String(robot?.chassis || "").includes("固定")) {
    return {
      kind: "manipulator",
      robot_count: 1,
      capabilities: ["camera", "joint_state", "manipulation"]
    };
  }
  if (Array.isArray(robot?.members) && robot.members.length >= 2) {
    return {
      kind: "fleet",
      robot_count: robot.members.length,
      capabilities: ["fleet_orchestrator", "navigation"]
    };
  }
  if (model.includes("QC")) {
    return {
      kind: "mobile_base",
      robot_count: 1,
      capabilities: ["camera", "navigation", "odometry"]
    };
  }
  return {
    kind: "mobile_base",
    robot_count: 1,
    capabilities: ["camera", "imu", "lidar", "localization", "navigation", "odometry"]
  };
}

function getAlgorithmRequirements(algorithm) {
  if (algorithm.evidence_kind === "mapping-runtime-qualification") {
    return {
      robot_kinds: ["mobile_base"],
      capabilities: ["camera", "imu", "lidar", "odometry"],
      scenes: ["warehouse", "retail-store"]
    };
  }
  if (algorithm.evidence_kind === "physics-simulation") {
    return catalogRequirements["bullet-panda-pick-place"];
  }
  if (algorithm.evidence_kind === "retail-digital-twin") {
    return catalogRequirements["retail-digital-twin-baseline"];
  }
  if (algorithm.execution_adapter === "cube-studio-argo-workflow") {
    return {
      robot_kinds: ["mobile_base"],
      capabilities: ["camera"],
      scenes: ["retail-store", "warehouse"]
    };
  }
  if (catalogRequirements[algorithm.catalog_key]) {
    return catalogRequirements[algorithm.catalog_key];
  }
  const descriptor = `${algorithm.name || ""} ${algorithm.module || ""}`.toLowerCase();
  if (descriptor.includes("机械臂") || descriptor.includes("arm")) {
    return {
      robot_kinds: ["manipulator"],
      capabilities: ["manipulation"],
      scenes: ["manipulation-cell"]
    };
  }
  if (descriptor.includes("视觉") || descriptor.includes("vision")) {
    return {
      robot_kinds: ["mobile_base", "manipulator"],
      capabilities: ["camera"],
      scenes: ["warehouse", "manipulation-cell"]
    };
  }
  return { robot_kinds: ["mobile_base"], capabilities: [], scenes: ["warehouse"] };
}

function resolveSimulationAlgorithms(requestedAlgorithms) {
  const algorithms = [];
  const errors = [];
  requestedAlgorithms.forEach((requested, index) => {
    const value = typeof requested === "object" && requested !== null ? requested : {};
    const registered = store.simulationAlgorithms.find(
      (algorithm) => String(algorithm.id) === String(value.id || "")
    );
    if (!registered) {
      errors.push(`第 ${index + 1} 个算法不是已注册的算法版本，已拒绝客户端自定义镜像或命令`);
      return;
    }
    if (value.version && String(value.version) !== String(registered.version)) {
      errors.push(`${registered.name} 版本不匹配：请求 ${value.version}，已注册 ${registered.version}`);
      return;
    }
    algorithms.push(registered);
  });
  return { algorithms, errors };
}

function buildCompatibilityReport(
  algorithms,
  scene = "warehouse",
  robot = store.robots[0],
  resolutionErrors = []
) {
  const sceneProfile = sceneProfiles[scene];
  const availableTypes = new Map(Object.entries(sceneProfile?.topics || {}));
  const errors = [...resolutionErrors];
  const warnings = [];
  const steps = [];
  const registeredRobot = robot?.id ? findItem(store.robots, robot.id) : null;
  const robotProfile = getRobotProfile(registeredRobot || robot);

  if (!sceneProfile) {
    errors.push(`未知场景 ${scene}，只能运行服务端登记的场景版本`);
  }
  if (!registeredRobot) {
    errors.push("机器人不是已注册资产");
  }
  if (
    sceneProfile &&
    !sceneProfile.compatible_robot_kinds.includes(robotProfile.kind)
  ) {
    errors.push(
      `${sceneProfile.label} 场景需要 ${sceneProfile.compatible_robot_kinds.join("/")}，当前机器人类型为 ${robotProfile.kind}`
    );
  }
  if (
    sceneProfile?.minimum_robots &&
    Number(robotProfile.robot_count || 1) < sceneProfile.minimum_robots
  ) {
    errors.push(`${sceneProfile.label} 至少需要 ${sceneProfile.minimum_robots} 台机器人`);
  }

  algorithms.forEach((algorithm, index) => {
    const inputs = Array.isArray(algorithm.inputs) ? algorithm.inputs : [];
    const generatedInputs = new Set(
      Array.isArray(algorithm.generated_inputs) ? algorithm.generated_inputs : []
    );
    const outputs = Array.isArray(algorithm.outputs) ? algorithm.outputs : [];
    const inputTypes = algorithm.input_types || {};
    const outputTypes = algorithm.output_types || {};
    const requirements = getAlgorithmRequirements(algorithm);
    const missingInputs = [];
    const typeMismatches = [];

    if (!algorithm.image) {
      errors.push(`${algorithm.name || `算法 ${index + 1}`} 缺少镜像定义`);
    }
    if (!algorithm.command) {
      errors.push(`${algorithm.name || `算法 ${index + 1}`} 缺少启动命令`);
    }
    if (!requirements.robot_kinds.includes(robotProfile.kind)) {
      errors.push(
        `${algorithm.name} 需要 ${requirements.robot_kinds.join("/")}，当前机器人类型为 ${robotProfile.kind}`
      );
    }
    if (requirements.scenes && !requirements.scenes.includes(scene)) {
      errors.push(`${algorithm.name} 不支持 ${sceneProfile?.label || scene} 场景`);
    }
    if (
      requirements.minimum_robots &&
      Number(robotProfile.robot_count || 1) < requirements.minimum_robots
    ) {
      errors.push(`${algorithm.name} 至少需要 ${requirements.minimum_robots} 台机器人`);
    }
    const missingCapabilities = requirements.capabilities.filter(
      (capability) => !robotProfile.capabilities.includes(capability)
    );
    if (missingCapabilities.length > 0) {
      errors.push(`${algorithm.name} 缺少机器人能力：${missingCapabilities.join("、")}`);
    }

    inputs.forEach((topic) => {
      if (!availableTypes.has(topic)) {
        if (generatedInputs.has(topic)) {
          warnings.push(`${algorithm.name} 的 ${topic} 由闭环 Workflow 在容器内生成并留存证据`);
          return;
        }
        missingInputs.push(topic);
        errors.push(`${algorithm.name} 缺少必需输入 ${topic}`);
        return;
      }
      const expectedType = inputTypes[topic];
      const actualType = availableTypes.get(topic);
      if (expectedType && actualType && expectedType !== actualType) {
        typeMismatches.push({ topic, expected: expectedType, actual: actualType });
        errors.push(
          `${algorithm.name} 的 ${topic} 类型不匹配：需要 ${expectedType}，当前为 ${actualType}`
        );
      }
    });

    outputs.forEach((topic) => {
      const outputType = outputTypes[topic] || null;
      const existingType = availableTypes.get(topic);
      if (outputType && existingType && outputType !== existingType) {
        errors.push(
          `${algorithm.name} 的输出 ${topic} 与已有类型冲突：${outputType} != ${existingType}`
        );
      }
      availableTypes.set(topic, outputType || existingType || "untyped");
    });

    if (algorithm.image_status === "build-required") {
      errors.push(`${algorithm.name} 尚未构建经过验证的 OCI 镜像，不能进入生产运行链`);
    }
    if (algorithm.execution_adapter !== "cube-studio-argo-workflow") {
      errors.push(`${algorithm.name} 尚未绑定真实 Cube Studio / Argo Workflow`);
    }
    if (!String(algorithm.image || "").includes("@sha256:")) {
      errors.push(`${algorithm.name} 必须使用不可变 OCI 镜像摘要（image@sha256:...）`);
    }
    if (!algorithm.workflow_manifest) {
      errors.push(`${algorithm.name} 缺少受控 Workflow 清单`);
    }
    if (algorithm.status === "quarantined") {
      warnings.push(`${algorithm.name} 当前为隔离资产，只允许执行资格验收，不能作为可上线算法发布`);
    }

    steps.push({
      id: algorithm.id,
      version: algorithm.version,
      name: algorithm.name,
      inputs,
      outputs,
      missing_inputs: missingInputs,
      type_mismatches: typeMismatches,
      robot_compatible:
        requirements.robot_kinds.includes(robotProfile.kind) &&
        missingCapabilities.length === 0 &&
        (!requirements.scenes || requirements.scenes.includes(scene)),
      adapter: algorithm.execution_adapter || "local-demo"
    });
  });

  const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 3);
  const hasArgoWorkflow = algorithms.length > 0 && algorithms.every(
    (algorithm) =>
      algorithm.execution_adapter === "cube-studio-argo-workflow" &&
      Boolean(algorithm.workflow_manifest) &&
      String(algorithm.image || "").includes("@sha256:")
  );
  const qualificationOnly = algorithms.some((algorithm) => algorithm.status === "quarantined");
  return {
    runnable: errors.length === 0 && hasArgoWorkflow,
    qualification_only: qualificationOnly,
    publishable_candidate: errors.length === 0 && hasArgoWorkflow && !qualificationOnly,
    score,
    scene,
    scene_version: sceneProfile?.version || null,
    scene_label: sceneProfile?.label || scene,
    robot_profile: robotProfile,
    execution_mode: hasArgoWorkflow ? "cube-studio-argo" : "not-runnable",
    evidence_level: hasArgoWorkflow ? "runtime-verified" : "none",
    errors,
    warnings,
    steps,
    available_topics: Object.fromEntries(availableTypes)
  };
}

function appendRunEvent(run, type, message, payload = {}) {
  run.events ??= [];
  run.events.push({
    seq: run.events.length + 1,
    timestamp: new Date().toISOString(),
    type,
    message,
    payload
  });
}

function buildRunManifest({ workflowName, scene, robot, algorithms, seed, faultMode }) {
  const sceneProfile = sceneProfiles[scene];
  const robotProfile = getRobotProfile(robot);
  const spec = {
    schema_version: "1.0",
    execution_mode: "cube-studio-argo",
    evidence_level: "runtime-verified",
    workflow_name: workflowName,
    scene: {
      id: scene,
      version: sceneProfile.version
    },
    robot: {
      id: robot.id,
      name: robot.name,
      model: robot.model,
      kind: robotProfile.kind,
      capabilities: robotProfile.capabilities
    },
    algorithms: algorithms.map((algorithm, order) => ({
      order,
      id: algorithm.id,
      catalog_key: algorithm.catalog_key || null,
      name: algorithm.name,
      version: algorithm.version,
      verified_commit: algorithm.verified_commit || null,
      image: algorithm.image,
      image_status: algorithm.image_status || "local"
    })),
    seed,
    fault_mode: faultMode
  };
  return {
    ...spec,
    sha256: createHash("sha256").update(JSON.stringify(spec)).digest("hex")
  };
}

function compactRunForList(run) {
  const playback = run.evidence?.playback;
  return {
    ...run,
    evidence: run.evidence
      ? {
          ...run.evidence,
          playback: playback
            ? { ...playback, keyframes: undefined, storage: "minio-archive" }
            : undefined
        }
      : undefined,
    events: (run.events || []).map((event) => ({
      ...event,
      payload: event.payload?.playback
        ? { ...event.payload, playback: { keyframe_count: event.payload.playback.keyframe_count } }
        : event.payload
    }))
  };
}

function sanitizeDeploymentRun(run) {
  return {
    id: run.id,
    workflow_name: run.workflow_name,
    status: run.status,
    progress: run.progress,
    revision: run.revision,
    algorithms: (run.algorithms || []).map((algorithm) => ({
      id: algorithm.id,
      name: algorithm.name,
      version: algorithm.version
    })),
    remote_workflow: run.remote_workflow
      ? {
          name: run.remote_workflow.name,
          namespace: run.remote_workflow.namespace,
          phase: run.remote_workflow.phase,
          uid: run.remote_workflow.uid
        }
      : null,
    outcome: run.outcome
      ? {
          validation_result: run.outcome.validation_result,
          publishable: run.outcome.publishable,
          reason: run.outcome.reason
        }
      : null,
    evidence: run.evidence
      ? {
          kind: run.evidence.kind,
          artifact_key: run.evidence.artifact_key,
          integrity: run.evidence.integrity
            ? { verified: run.evidence.integrity.verified === true }
            : null,
          blocker_count: Array.isArray(run.evidence.blockers) ? run.evidence.blockers.length : 0
        }
      : null,
    started_at: run.started_at,
    finished_at: run.finished_at
  };
}

function resolveWorkflowManifest(manifestPath) {
  const requested = String(manifestPath || "").replaceAll("\\", "/");
  const resolved = path.resolve(workspaceDir, requested);
  const algorithmRoot = `${path.resolve(workspaceDir, "algorithm")}${path.sep}`;
  if (!resolved.startsWith(algorithmRoot) || !resolved.endsWith(".yaml")) {
    throw new Error("Workflow manifest 必须位于工作区 algorithm 目录并使用 YAML 格式");
  }
  return resolved;
}

async function submitArgoWorkflow(manifestPath) {
  const resolvedManifest = resolveWorkflowManifest(manifestPath);
  await stat(resolvedManifest);
  const resource = await kubernetesClient.createWorkflow(resolvedManifest);
  return {
    name: resource.metadata?.name,
    namespace: resource.metadata?.namespace || "pipeline",
    uid: resource.metadata?.uid || null,
    manifest_path: path.relative(workspaceDir, resolvedManifest).replaceAll("\\", "/")
  };
}

function extractTarEntry(archiveBuffer, suffix) {
  const tarBuffer = gunzipSync(archiveBuffer);
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const dataStart = offset + 512;
    if (name.endsWith(suffix)) {
      return tarBuffer.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Workflow 证据包中缺少 ${suffix}`);
}

function extractTarJson(archiveBuffer, suffix) {
  return JSON.parse(extractTarEntry(archiveBuffer, suffix).toString("utf8"));
}

function listTarEntries(archiveBuffer) {
  const tarBuffer = gunzipSync(archiveBuffer);
  const names = [];
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (name) names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

function verifyEvidenceChecksums(archiveBuffer, requiredFiles) {
  let expected = {};
  try {
    expected = extractTarJson(archiveBuffer, "SHA256SUMS.json");
  } catch {
    const lines = extractTarEntry(archiveBuffer, "SHA256SUMS")
      .toString("utf8")
      .trim()
      .split(/\r?\n/);
    expected = Object.fromEntries(lines.map((line) => {
      const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
      if (!match) throw new Error("SHA256SUMS 格式无效");
      return [path.basename(match[2].trim()), match[1].toLowerCase()];
    }));
  }
  const verifiedFiles = {};
  for (const fileName of requiredFiles) {
    const expectedDigest = String(expected[fileName] || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
      throw new Error(`证据校验清单缺少 ${fileName}`);
    }
    const actualDigest = createHash("sha256")
      .update(extractTarEntry(archiveBuffer, fileName))
      .digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new Error(`证据文件 ${fileName} 的 SHA-256 校验失败`);
    }
    verifiedFiles[fileName] = actualDigest;
  }
  return { algorithm: "SHA-256", verified: true, files: verifiedFiles };
}

function findWorkflowArtifact(workflow, artifactName) {
  for (const node of Object.values(workflow.status?.nodes || {})) {
    const artifact = node?.outputs?.artifacts?.find((item) => item.name === artifactName);
    if (artifact?.s3?.key) return artifact.s3.key;
  }
  return null;
}

async function updateArgoRun(run) {
  if (
    run.execution_mode !== "cube-studio-argo" ||
    !["running", "starting", "interrupted", "canceling"].includes(run.status)
  ) {
    return false;
  }
  const workflow = await kubernetesClient.getWorkflow(
    run.remote_workflow.namespace,
    run.remote_workflow.name
  );
  const phase = workflow.status?.phase || "Pending";
  const previous = `${run.status}:${run.progress}:${run.artifact_id || ""}`;
  const now = new Date().toISOString();
  run.remote_workflow.phase = phase;
  run.remote_workflow.started_at = workflow.status?.startedAt || run.started_at;
  run.remote_workflow.finished_at = workflow.status?.finishedAt || null;
  run.updated_at = now;
  delete run.interruption_reason;
  delete run.last_sync_error;

  if (["Pending", "Running"].includes(phase)) {
    run.status = run.cancel_requested_at ? "canceling" : "running";
    run.progress = phase === "Pending" ? 10 : 65;
    run.container_states = run.container_states.map((state) => ({
      ...state,
      status: run.cancel_requested_at ? "canceling" : phase === "Pending" ? "pulling" : "running"
    }));
  } else if (phase === "Succeeded") {
    const artifactKey = findWorkflowArtifact(workflow, "closed-loop-evidence");
    if (!artifactKey) throw new Error("Argo Workflow 成功，但未返回 closed-loop-evidence 产物");
    const archive = await artifactStore.readWorkflowKey(artifactKey);
    const isPhysicsSimulation = run.algorithms?.some(
      (algorithm) => algorithm.evidence_kind === "physics-simulation"
    );
    const isRetailDigitalTwin = run.algorithms?.some(
      (algorithm) => algorithm.evidence_kind === "retail-digital-twin"
    );
    const isImageEdgeDetection = run.algorithms?.some(
      (algorithm) => algorithm.evidence_kind === "image-edge-detection"
    );
    const isMappingRuntimeQualification = run.algorithms?.some(
      (algorithm) => algorithm.evidence_kind === "mapping-runtime-qualification"
    );
    let verified = false;
    let publishable = false;
    let validationResult = "failed";
    let evidencePayload;
    let outcomeReason;

    if (isMappingRuntimeQualification) {
      const qualification = extractTarJson(archive, "mapping-runtime-report.json");
      const integrity = verifyEvidenceChecksums(archive, [
        "mapping-runtime-report.json",
        "runtime-probe.log"
      ]);
      verified =
        integrity.verified === true &&
        ["blocked", "succeeded"].includes(qualification.status) &&
        qualification.assertions?.immutable_image_digest === true &&
        qualification.assertions?.source_tree_present === true &&
        qualification.assertions?.model_present === true;
      publishable = verified && qualification.publishable === true;
      validationResult = verified ? (publishable ? "passed" : "blocked") : "failed";
      evidencePayload = {
        kind: "mapping-runtime-qualification",
        artifact_key: artifactKey,
        algorithm: qualification.algorithm,
        runtime: qualification.runtime,
        delivery: qualification.delivery,
        probe: qualification.probe,
        assertions: qualification.assertions,
        blockers: qualification.blockers || [],
        required_fix: qualification.required_fix || [],
        publishable,
        integrity
      };
      const simulationTimestamp = workflow.status?.finishedAt || now;
      const trustedMetric = (value, unit) => ({
        value,
        unit,
        source: "fastlivo2-delivery-container",
        timestamp: simulationTimestamp,
        trustworthy: true
      });
      run.metrics = {
        source_files: trustedMetric(qualification.delivery?.source_file_count ?? 0, "files"),
        model_bytes: trustedMetric(qualification.delivery?.model_bytes ?? 0, "bytes"),
        dataset_count: trustedMetric(qualification.delivery?.dataset_count ?? 0, "datasets"),
        blocker_count: trustedMetric(qualification.blockers?.length ?? 0, "blockers")
      };
      outcomeReason = publishable
        ? "FAST-LIVO2 交付镜像运行时验收通过，可进入传感器数据回放阶段"
        : `FAST-LIVO2 交付镜像验收完成，但存在 ${qualification.blockers?.length || 0} 个上线阻断项，禁止作为可运行建图算法发布`;
    } else if (isImageEdgeDetection) {
      const edge = extractTarJson(archive, "edge-run.json");
      const integrity = verifyEvidenceChecksums(archive, [
        "input.png",
        "edge.png",
        "edge-run.json"
      ]);
      verified =
        integrity.verified === true &&
        edge.status === "succeeded" &&
        edge.publishable === true &&
        Object.values(edge.assertions || {}).every((value) => value === true);
      evidencePayload = {
        kind: "image-edge-detection",
        artifact_key: artifactKey,
        algorithm: edge.algorithm,
        metrics: edge.metrics,
        assertions: edge.assertions,
        assets: edge.assets,
        input_asset: { path: "input.png", format: "PNG" },
        edge_asset: { path: "edge.png", format: "PNG" },
        visual_assets: {
          input: { path: "input.png", format: "PNG", source: "workflow-generated" },
          output: { path: "edge.png", format: "PNG", source: "algorithm-container" }
        },
        integrity
      };
      const simulationTimestamp = workflow.status?.finishedAt || now;
      const trustedMetric = (value, unit) => ({
        value,
        unit,
        source: "imagemagick-edge-container",
        timestamp: simulationTimestamp,
        trustworthy: true
      });
      run.metrics = {
        image_width: trustedMetric(edge.metrics?.width_px ?? null, "px"),
        image_height: trustedMetric(edge.metrics?.height_px ?? null, "px"),
        edge_mean: trustedMetric(edge.metrics?.edge_mean ?? null, "normalized"),
        edge_radius: trustedMetric(edge.metrics?.radius ?? null, "px")
      };
      outcomeReason = verified
        ? `Docker Hub ImageMagick 边缘检测通过：${edge.metrics?.width_px || 0}x${edge.metrics?.height_px || 0}，边缘均值 ${Number(edge.metrics?.edge_mean || 0).toFixed(4)}`
        : "ImageMagick 边缘检测的输出、尺寸或信号断言未通过";
    } else if (isRetailDigitalTwin) {
      const retail = extractTarJson(archive, "retail-run.json");
      const integrity = verifyEvidenceChecksums(archive, [
        "retail-run.json",
        "retail-store.pcd",
        "retail-store.obj",
        "navigation-trajectory.json",
        "preview.png"
      ]);
      verified =
        integrity.verified === true &&
        retail.status === "succeeded" &&
        retail.publishable === true &&
        Object.values(retail.assertions || {}).every((value) => value === true);
      evidencePayload = {
        kind: "retail-digital-twin",
        artifact_key: artifactKey,
        validation_profile: retail.validation_profile,
        full_stack_ready: retail.full_stack_ready === true,
        input: retail.input,
        scene: retail.scene,
        perception: retail.perception,
        task: retail.task,
        navigation: retail.navigation,
        manipulation: retail.manipulation,
        assertions: retail.assertions,
        blockers: retail.blockers || [],
        runtime: retail.runtime,
        integrity,
        mesh_asset: { path: "retail-store.obj", format: "OBJ" },
        preview_asset: { path: "preview.png", format: "PNG" }
      };
      const simulationTimestamp = workflow.status?.finishedAt || now;
      const trustedMetric = (value, unit) => ({
        value,
        unit,
        source: "retail-digital-twin-container",
        timestamp: simulationTimestamp,
        trustworthy: true
      });
      run.metrics = {
        point_count: trustedMetric(retail.input?.point_count ?? null, "points"),
        mesh_faces: trustedMetric(retail.scene?.mesh?.faces ?? null, "faces"),
        navigation_path: trustedMetric(retail.navigation?.path_length_m ?? null, "m"),
        perception_detections: trustedMetric(
          retail.perception?.detection_count ?? null,
          "objects"
        ),
        elapsed_time: trustedMetric(retail.runtime?.elapsed_ms ?? null, "ms")
      };
      outcomeReason = verified
        ? `便利店传统闭环通过：${retail.input?.point_count || 0} 点、${retail.scene?.mesh?.faces || 0} 面、导航 ${retail.navigation?.path_length_m || 0} m；VLA 等待真实模型服务`
        : "便利店点云重建、导航或传统抓取断言未通过";
    } else if (isPhysicsSimulation) {
      const simulation = extractTarJson(archive, "simulation-run.json");
      const integrity = verifyEvidenceChecksums(archive, [
        "simulation-run.json",
        "trajectory.json",
        "preview.png"
      ]);
      const renderedFrames = listTarEntries(archive)
        .filter((name) => /(?:^|\/)frames\/frame-\d+\.png$/.test(name))
        .sort();
      verified =
        integrity.verified === true &&
        simulation.status === "succeeded" &&
        simulation.publishable === true &&
        Object.values(simulation.assertions || {}).every((value) => value === true);
      evidencePayload = {
        kind: "physics-simulation",
        artifact_key: artifactKey,
        engine: simulation.engine,
        algorithm: simulation.algorithm,
        scene: simulation.scene,
        assertions: simulation.assertions,
        metrics: simulation.metrics,
        playback: simulation.playback,
        rendered_frames: { count: renderedFrames.length, renderer: simulation.engine?.renderer },
        runtime: simulation.runtime,
        seed: simulation.seed,
        integrity
      };
      const simulationTimestamp = workflow.status?.finishedAt || now;
      const trustedMetric = (value, unit) => ({
        value,
        unit,
        source: "bullet-physics-container",
        timestamp: simulationTimestamp,
        trustworthy: true
      });
      run.metrics = {
        real_time_factor: trustedMetric(simulation.metrics?.real_time_factor ?? null, "x"),
        final_position_error: trustedMetric(
          simulation.metrics?.final_position_error_m ?? null,
          "m"
        ),
        object_transfer_distance: trustedMetric(
          simulation.metrics?.object_transfer_distance_m ?? null,
          "m"
        ),
        collision_count: trustedMetric(simulation.metrics?.safety_contact_steps ?? null, "steps"),
        sim_time: trustedMetric(simulation.metrics?.simulated_seconds ?? null, "s")
      };
      const distance = Number(simulation.metrics?.object_transfer_distance_m || 0).toFixed(3);
      const errorMm = (Number(simulation.metrics?.final_position_error_m || 0) * 1000).toFixed(2);
      outcomeReason = verified
        ? `Bullet 物理闭环通过：工件搬运 ${distance} m，目标误差 ${errorMm} mm，高力碰撞 0 次`
        : "Bullet 物理仿真的安全或目标断言未通过";
    } else {
      const barcodeEvidence = extractTarJson(archive, "closed-loop.json");
      const algorithmResult = extractTarJson(archive, "result.json");
      const integrity = verifyEvidenceChecksums(archive, [
        "input.png",
        "result.json",
        "closed-loop.json"
      ]);
      verified =
        integrity.verified === true &&
        barcodeEvidence.closed_loop === true &&
        String(barcodeEvidence.expected) === String(barcodeEvidence.detected?.text) &&
        algorithmResult.status === "succeeded";
      evidencePayload = {
        kind: "barcode-recognition",
        artifact_key: artifactKey,
        expected_barcode: barcodeEvidence.expected,
        detected_barcode: barcodeEvidence.detected?.text || null,
        barcode_format: barcodeEvidence.detected?.format || null,
        input_sha256: barcodeEvidence.input_sha256,
        upstream_commit: barcodeEvidence.upstream_commit,
        elapsed_ms: algorithmResult.elapsed_ms,
        found: algorithmResult.found,
        visual_assets: {
          input: { path: "input.png", format: "PNG", source: "workflow-generated" },
          output: null
        },
        integrity
      };
      outcomeReason = verified
        ? `真实容器识别成功：${barcodeEvidence.expected} → ${barcodeEvidence.detected?.text}`
        : "条码识别结果与期望值不一致";
    }
    if (!isMappingRuntimeQualification) {
      publishable = verified;
      validationResult = verified ? "passed" : "failed";
    }
    run.status = verified ? "completed" : "failed";
    run.progress = 100;
    run.finished_at = workflow.status?.finishedAt || now;
    run.container_states = run.container_states.map((state) => ({
      ...state,
      status: verified ? "completed" : "failed"
    }));
    run.evidence = evidencePayload;
    run.outcome = {
      code: verified
        ? isMappingRuntimeQualification
          ? publishable
            ? "mapping-runtime-qualification-succeeded"
            : "mapping-runtime-qualification-blocked"
          : isImageEdgeDetection
          ? "image-edge-detection-succeeded"
          : isRetailDigitalTwin
            ? "retail-digital-twin-baseline-succeeded"
            : isPhysicsSimulation
              ? "physics-simulation-succeeded"
              : "cube-studio-closed-loop-succeeded"
        : "cube-studio-assertion-failed",
      validation_result: validationResult,
      publishable,
      reason: outcomeReason
    };
    if (!run.artifact_id) {
      const artifact = {
        id: `artifact-${randomUUID()}`,
        run_id: run.id,
        name: `${run.remote_workflow.name}-${isMappingRuntimeQualification ? "mapping-qualification" : isImageEdgeDetection ? "image-edge" : isRetailDigitalTwin ? "retail-digital-twin" : isPhysicsSimulation ? "physics" : "closed-loop"}-evidence.tgz`,
        content_type: "application/gzip",
        storage: {
          provider: "cube-minio",
          bucket: process.env.MINIO_BUCKET || "mlpipeline",
          object_key: artifactKey,
          size: archive.length
        },
        created_at: now
      };
      store.artifacts.push(artifact);
      run.artifact_id = artifact.id;
    }
    appendRunEvent(
      run,
      verified
        ? isMappingRuntimeQualification && !publishable
          ? "qualification_blocked"
          : "result"
        : "assertion_failed",
      run.outcome.reason,
      run.evidence
    );
  } else {
    const canceledByUser = Boolean(run.cancel_requested_at);
    run.status = canceledByUser ? "canceled" : "failed";
    run.progress = 100;
    run.finished_at = workflow.status?.finishedAt || now;
    run.failure_reason = canceledByUser
      ? "用户已通过平台停止真实 Argo Workflow"
      : workflow.status?.message || `Argo Workflow ${phase}`;
    run.container_states = run.container_states.map((state) => ({
      ...state,
      status: canceledByUser ? "canceled" : "failed"
    }));
    run.outcome = {
      code: canceledByUser ? "cube-studio-workflow-canceled" : "cube-studio-workflow-failed",
      validation_result: canceledByUser ? "not_evaluated" : "failed",
      publishable: false,
      reason: run.failure_reason
    };
    appendRunEvent(run, canceledByUser ? "control" : "error", run.failure_reason, { phase });
  }

  run.revision = Number(run.revision || 0) + 1;
  return previous !== `${run.status}:${run.progress}:${run.artifact_id || ""}`;
}

async function refreshSimulationRun(run) {
  if (run.execution_mode !== "cube-studio-argo") return false;
  try {
    return await updateArgoRun(run);
  } catch (error) {
    run.last_sync_error = error instanceof Error ? error.message : String(error);
    run.updated_at = new Date().toISOString();
    console.warn(`同步 Argo Workflow ${run.remote_workflow?.name || run.id} 失败，将自动重试:`, error);
    return false;
  }
}

async function hydratePhysicsPlayback(run) {
  if (
    run.evidence?.kind !== "physics-simulation" ||
    run.evidence?.playback?.keyframes?.length ||
    !run.evidence?.artifact_key
  ) {
    return;
  }
  const archive = await artifactStore.readWorkflowKey(run.evidence.artifact_key);
  const simulation = extractTarJson(archive, "simulation-run.json");
  run.evidence.playback = simulation.playback;
}

function normalizeItem(collectionName, item) {
  if (collectionName === "robots") return normalizeRobot(item);
  if (collectionName === "pipelines") return normalizePipeline(item);
  if (collectionName === "algorithms") return normalizeAlgorithm(item);
  if (collectionName === "datasets") return normalizeDataset(item);
  if (collectionName === "codeModules") return normalizeCodeModule(item);
  if (collectionName === "simulationAlgorithms") return normalizeSimulationAlgorithm(item);
  return item;
}

async function handleCollectionApi(request, response, pathname) {
  const match = pathname.match(
    /^\/(images_modelview|project_modelview|dataset_modelview|pipeline_modelview|robot_modelview|code_repository|simulation_algorithm)\/api(?:\/([^/]+))?\/?$/
  );
  if (!match) return false;

  const collectionName = collectionRoutes[match[1]];
  const collection = store[collectionName];
  const id = match[2] ? decodeURIComponent(match[2]) : null;

  if (request.method === "GET" && !id) {
    sendJson(response, 200, { result: { data: collection, count: collection.length } });
    return true;
  }

  if (request.method === "GET" && id) {
    const item = findItem(collection, id);
    if (!item) {
      sendError(response, 404, "资源不存在");
      return true;
    }
    sendJson(response, 200, { result: item });
    return true;
  }

  if (request.method === "POST" && !id) {
    const body = await readBody(request);
    const item = normalizeItem(collectionName, {
      ...body,
      id: body.id || nextId(collection)
    });
    collection.push(item);
    await persistStore();
    sendJson(response, 201, { result: item });
    return true;
  }

  if (request.method === "PUT" && id) {
    const index = collection.findIndex((item) => String(item.id) === String(id));
    if (index < 0) {
      sendError(response, 404, "资源不存在");
      return true;
    }
    const body = await readBody(request);
    const item = normalizeItem(collectionName, {
      ...collection[index],
      ...body,
      id: collection[index].id
    });
    collection[index] = item;
    await persistStore();
    sendJson(response, 200, { result: item });
    return true;
  }

  if (request.method === "DELETE" && id) {
    const index = collection.findIndex((item) => String(item.id) === String(id));
    if (index < 0) {
      sendError(response, 404, "资源不存在");
      return true;
    }
    const [deleted] = collection.splice(index, 1);
    await persistStore();
    sendJson(response, 200, { result: { id: deleted.id, deleted: true } });
    return true;
  }

  sendError(response, 405, "不支持的请求方法");
  return true;
}

async function serveStatic(response, pathname) {
  let relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  let requestedPath = path.resolve(staticDir, relativePath);

  if (!requestedPath.startsWith(staticDir)) {
    sendError(response, 403, "禁止访问");
    return;
  }

  try {
    const fileStat = await stat(requestedPath);
    if (fileStat.isDirectory()) requestedPath = path.join(requestedPath, "index.html");
  } catch {
    if (!path.extname(relativePath)) {
      requestedPath = path.join(staticDir, "index.html");
    }
  }

  try {
    const body = await readFile(requestedPath);
    const contentType = contentTypes[path.extname(requestedPath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch {
    sendError(response, 404, "页面或资源不存在，请先运行 npm run build");
  }
}

const localSessions = {
  "local-admin-token": { username: "admin", role: "admin" },
  "local-demo-token": { username: "demo", role: "viewer" }
};

function getSession(request) {
  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) return null;
  if (localSessions[token]) return localSessions[token];
  // 仅在显式启用受信任的 Cube Studio 反向代理时接受短用户名令牌。
  if (process.env.TRUST_CUBE_STUDIO_SHORT_AUTH === "true" && cubeStudio.configured && token.length < 40) {
    return {
      username: token,
      role: token === "admin" ? "admin" : "viewer"
    };
  }
  return null;
}

function isProtectedApiPath(pathname) {
  return [
    "/images_modelview/",
    "/project_modelview/",
    "/dataset_modelview/",
    "/pipeline_modelview/",
    "/robot_modelview/",
    "/code_repository/",
    "/simulation_algorithm/",
    "/deploy",
    "/deployments",
    "/simulation/",
    "/platform/",
    "/robot-design/",
    "/edge/"
  ].some((prefix) => pathname.startsWith(prefix));
}

function requiresAdmin(request, pathname) {
  if (request.method === "GET") return false;
  if (pathname === "/simulation/preflight") return false;
  return true;
}

function recoverLegacyRuns() {
  const now = new Date().toISOString();
  let recovered = 0;
  for (const run of store.simulationRuns) {
    if (
      ["running", "paused", "starting"].includes(run.status) &&
      !run.run_manifest
    ) {
      run.status = "interrupted";
      run.finished_at = now;
      run.updated_at = now;
      run.failure_reason = "服务重启时检测到旧版运行缺少可恢复清单";
      run.revision = Number(run.revision || 0) + 1;
      run.outcome = {
        code: "legacy-run-interrupted",
        validation_result: "not_evaluated",
        publishable: false,
        reason: run.failure_reason
      };
      appendRunEvent(run, "recovery", run.failure_reason);
      recovered += 1;
    }
  }
  return recovered;
}

recoverLegacyRuns();
await persistStore();

const edgeService = createEdgeService({ store, persistStore, readBody, sendJson, sendError });

const server = http.createServer(async (request, response) => {
  setCommonHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (pathname === "/health/live" || pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        backend: "cube-studio-compatible-lite",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/health/ready") {
      const [artifactHealth, kubernetesHealth] = await Promise.all([
        artifactStore.health(),
        kubernetesClient.health()
      ]);
      const ready = artifactHealth.reachable === true && kubernetesHealth.reachable === true;
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "not-ready",
        dependencies: {
          artifact_store: artifactHealth,
          kubernetes: kubernetesHealth
        },
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/login/" && request.method === "POST") {
      const body = await readBody(request);
      const production = process.env.NODE_ENV === "production";
      const accounts = {
        admin: process.env.LOCAL_ADMIN_PASSWORD || (production ? null : "admin123"),
        demo: process.env.LOCAL_VIEWER_PASSWORD || (production ? null : "demo123")
      };
      if (!accounts.admin && !accounts.demo) {
        sendError(response, 503, "生产环境未配置本地登录凭据，请使用统一身份认证");
        return;
      }
      if (!accounts[body.username] || accounts[body.username] !== body.password) {
        sendError(response, 401, "用户名或密码错误");
        return;
      }
      sendJson(response, 200, {
        id: body.username === "admin" ? 1 : 2,
        username: body.username,
        roles: [body.username === "admin" ? "admin" : "viewer"],
        token: `local-${body.username}-token`
      });
      return;
    }

    // Edge Agent 使用独立凭据；这些请求不是浏览器会话。
    if (await edgeService.handleAgentRequest(request, response, pathname)) return;

    if (isProtectedApiPath(pathname)) {
      const session = getSession(request);
      if (!session) {
        sendError(response, 401, "缺少有效的 Bearer 会话");
        return;
      }
      if (requiresAdmin(request, pathname) && session.role !== "admin") {
        sendError(response, 403, "当前账号只有只读权限");
        return;
      }
    }

    if (await handleCollectionApi(request, response, pathname)) return;

    // 浏览器只访问平台后端，由后端向 Agent 队列下发部署任务。
    if (await edgeService.handlePlatformRequest(request, response, pathname, url)) return;

    if (pathname === "/deployment/catalog" && request.method === "GET") {
      let shouldPersist = false;
      for (const run of store.simulationRuns) {
        const previousStatus = run.status;
        const changed = await refreshSimulationRun(run);
        if (changed || previousStatus !== run.status) shouldPersist = true;
      }
      if (shouldPersist) await persistStore();

      const algorithms = store.simulationAlgorithms
        .filter(
          (algorithm) =>
            algorithm.execution_adapter === "cube-studio-argo-workflow" &&
            Boolean(algorithm.workflow_manifest) &&
            String(algorithm.image || "").includes("@sha256:")
        )
        .map((algorithm) => ({
          id: algorithm.id,
          name: algorithm.name,
          module: algorithm.module,
          version: algorithm.version,
          image: algorithm.image,
          image_digest: algorithm.image_digest || String(algorithm.image).split("@")[1] || null,
          image_status: algorithm.image_status,
          platforms: algorithm.platforms || [],
          runtime: algorithm.runtime,
          inputs: algorithm.inputs || [],
          outputs: algorithm.outputs || [],
          input_types: algorithm.input_types || {},
          output_types: algorithm.output_types || {},
          generated_inputs: algorithm.generated_inputs || [],
          description: algorithm.description,
          status: algorithm.status,
          color: algorithm.color,
          execution_adapter: algorithm.execution_adapter,
          workflow_bound: true,
          evidence_kind: algorithm.evidence_kind,
          recommended_robot_ids: algorithm.recommended_robot_ids || []
        }));
      const algorithmIds = new Set(algorithms.map((algorithm) => String(algorithm.id)));
      const pipelines = store.pipelines
        .filter(
          (pipeline) =>
            Array.isArray(pipeline.algorithm_ids) &&
            pipeline.algorithm_ids.some((id) => algorithmIds.has(String(id))) &&
            Boolean(pipeline.workflow_manifest)
        )
        .map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          description: pipeline.description,
          status: pipeline.status,
          algorithm_ids: pipeline.algorithm_ids,
          recommended_robot_ids: pipeline.recommended_robot_ids || [],
          workflow_bound: true
        }));
      const robots = store.robots.map((robot) => ({
        id: robot.id,
        name: robot.name,
        model: robot.model,
        chassis: robot.chassis,
        actuator: robot.actuator,
        deployment_target: robot.deployment_target
      }));
      const scenarios = Object.values(sceneProfiles).map((scene) => ({
        id: scene.id,
        label: scene.label,
        version: scene.version,
        compatible_robot_kinds: scene.compatible_robot_kinds,
        minimum_robots: scene.minimum_robots || 1
      }));
      const runs = store.simulationRuns
        .filter((run) => run.execution_mode === "cube-studio-argo")
        .slice()
        .reverse()
        .slice(0, 30)
        .map(sanitizeDeploymentRun);

      sendJson(response, 200, {
        result: {
          algorithms,
          pipelines,
          robots,
          scenarios,
          runs,
          inventory: {
            total_registered: store.simulationAlgorithms.length,
            black_box_deliveries: algorithms.length,
            pending_packaging: Math.max(0, store.simulationAlgorithms.length - algorithms.length)
          },
          policy: {
            source_fields_exposed: false,
            immutable_digest_required: true,
            controlled_workflow_required: true,
            evidence_required: true
          }
        }
      });
      return;
    }

    if (pathname === "/platform/capabilities" && request.method === "GET") {
      const [cubeHealth, artifactHealth] = await Promise.all([
        cubeStudio.health(),
        artifactStore.health()
      ]);
      sendJson(response, 200, {
        result: {
          configuration: platformConfiguration(),
          health: {
            cube_studio: cubeHealth,
            artifact_store: artifactHealth
          },
          constraints: {
            local_mode:
              "本地兼容模式验证 API、状态机、镜像摘要追踪和产物归档，不等同于真实容器构建或 ROS/Gazebo 仿真",
            cube_studio_mode:
              "真实模式使用 Cube Studio Docker、Repository 与 Pipeline API；镜像保存仍遵循 Cube Studio 的调试容器提交机制"
          }
        }
      });
      return;
    }

    if (pathname === "/platform/registry/repositories" && request.method === "GET") {
      let data = [...(store.registryRepositories || [])];
      if (cubeStudio.configured) {
        try {
          const remote = await cubeStudio.listRepositories();
          const remoteRows = remote.payload?.result?.data || [];
          const mapped = remoteRows.map((row) => ({
            id: row.id,
            name: row.name,
            server: row.server,
            hubsecret: row.hubsecret || row.name,
            provider: "cube-studio",
            status: "ready",
            created_at: row.created_on || row.modified || new Date().toISOString()
          }));
          const localIds = new Set(mapped.map((item) => String(item.id)));
          data = [
            ...mapped,
            ...data.filter((item) => !localIds.has(String(item.id)))
          ];
        } catch (error) {
          console.warn("同步 Cube Studio 镜像仓库失败:", error);
        }
      }
      sendJson(response, 200, {
        result: {
          data,
          count: data.length
        }
      });
      return;
    }

    if (pathname === "/platform/registry/repositories" && request.method === "POST") {
      const body = await readBody(request);
      if (
        !String(body.name || "").trim() ||
        !String(body.server || "").trim() ||
        !String(body.hubsecret || "").trim()
      ) {
        sendError(response, 400, "仓库名称、服务地址和 hubsecret 不能为空");
        return;
      }
      let remote = null;
      if (cubeStudio.configured) {
        if (!body.user || !body.password) {
          sendError(response, 400, "真实 Cube Studio 仓库需要用户名和密码");
          return;
        }
        remote = await cubeStudio.createRepository(body);
      }
      const repository = {
        id:
          remote?.payload?.result?.id ||
          remote?.payload?.id ||
          `repository-${randomUUID()}`,
        name: String(body.name).trim(),
        server: String(body.server).trim(),
        hubsecret: String(body.hubsecret).trim(),
        provider: cubeStudio.configured ? "cube-studio" : "local-compatible",
        status: cubeStudio.configured ? "submitted" : "metadata-only",
        remote_status: remote?.status || null,
        created_at: new Date().toISOString()
      };
      store.registryRepositories.push(repository);
      await persistStore();
      sendJson(response, 201, { result: repository });
      return;
    }

    if (pathname === "/platform/image-builds" && request.method === "POST") {
      const body = await readBody(request);
      const codeModule = findItem(store.codeModules, body.code_module_id);
      if (!codeModule) {
        sendError(response, 404, "代码模块不存在");
        return;
      }
      if (!isValidImageReference(body.target_image)) {
        sendError(
          response,
          400,
          "目标镜像必须是带仓库和标签的引用，例如 harbor.local/robot/slam:2.1.0"
        );
        return;
      }
      const baseImage = String(body.base_image || "ros:humble-ros-base").trim();
      if (!/^[a-zA-Z0-9._:@/-]{3,240}$/.test(baseImage)) {
        sendError(response, 400, "基础镜像格式不合法");
        return;
      }
      const now = new Date().toISOString();
      const build = {
        id: `build-${randomUUID()}`,
        code_module_id: codeModule.id,
        code_module_name: codeModule.name,
        repository_url: codeModule.repository_url,
        source_ref: String(body.source_ref || codeModule.verified_commit || codeModule.branch || "main"),
        dockerfile: String(body.dockerfile || "Dockerfile"),
        base_image: baseImage,
        target_image: String(body.target_image).trim(),
        description: String(body.description || `${codeModule.name} 镜像构建`),
        resource_cpu: String(body.resource_cpu || "2"),
        resource_memory: String(body.resource_memory || "4G"),
        provider: cubeStudio.configured ? "cube-studio" : "local-compatible",
        evidence_level: cubeStudio.configured
          ? "cube-studio-submission"
          : "local-metadata-rehearsal",
        status: cubeStudio.configured ? "submitting" : "queued",
        phase: cubeStudio.configured ? "提交 Cube Studio Docker 记录" : "等待构建执行器",
        progress: cubeStudio.configured ? 2 : 0,
        submitted_at: now,
        updated_at: now,
        logs: [
          {
            timestamp: now,
            level: "info",
            message: `已锁定源码 ${codeModule.repository_url}#${body.source_ref || codeModule.branch || "main"}`
          }
        ]
      };
      build.build_manifest = buildImageManifest(build, codeModule);

      if (cubeStudio.configured) {
        const remote = await cubeStudio.createDockerBuild(build);
        build.remote_id =
          remote.payload?.result?.id || remote.payload?.id || remote.payload?.result?.data?.id || null;
        build.remote_status = remote.status;
        build.remote_location = remote.location;
        build.status = "awaiting_cube_debug";
        build.phase = "等待 Cube Studio 调试容器保存并推送";
        build.progress = 10;
        build.logs.push({
          timestamp: new Date().toISOString(),
          level: "info",
          message:
            "Docker 记录已提交；请在 Cube Studio 完成调试容器启动、环境安装和保存推送"
        });
      }
      store.imageBuilds.push(build);
      await persistStore();
      sendJson(response, 201, { result: build });
      return;
    }

    if (pathname === "/platform/image-builds" && request.method === "GET") {
      await refreshPlatformJobs();
      let data = store.imageBuilds.slice().reverse();
      if (cubeStudio.configured) {
        try {
          const remote = await cubeStudio.listDockerBuilds();
          const remoteRows = remote.payload?.result?.data || [];
          const mapped = remoteRows.map((row) => ({
            id: `cube-docker-${row.id}`,
            remote_id: row.id,
            code_module_name: row.describe || row.target_image || `docker-${row.id}`,
            target_image: row.target_image,
            base_image: row.base_image,
            provider: "cube-studio",
            evidence_level: "cube-studio-docker-record",
            status: "awaiting_cube_debug",
            phase: "Cube Studio Docker 记录（需调试容器保存推送）",
            progress: 10,
            submitted_at: row.created_on || row.modified || new Date().toISOString(),
            updated_at: row.changed_on || row.modified || new Date().toISOString(),
            build_manifest: { sha256: null, target_image: row.target_image }
          }));
          const remoteIds = new Set(mapped.map((item) => String(item.remote_id)));
          data = [
            ...mapped,
            ...data.filter((item) => !item.remote_id || !remoteIds.has(String(item.remote_id)))
          ];
        } catch (error) {
          console.warn("同步 Cube Studio Docker 构建失败:", error);
        }
      }
      sendJson(response, 200, {
        result: {
          data,
          count: data.length
        }
      });
      return;
    }

    const imageBuildMatch = pathname.match(/^\/platform\/image-builds\/([^/]+)$/);
    if (imageBuildMatch && request.method === "GET") {
      await refreshPlatformJobs();
      const build = findItem(store.imageBuilds, decodeURIComponent(imageBuildMatch[1]));
      if (!build) {
        sendError(response, 404, "镜像构建任务不存在");
        return;
      }
      sendJson(response, 200, { result: build });
      return;
    }

    if (pathname === "/platform/registry/images" && request.method === "GET") {
      await refreshPlatformJobs();
      let data = store.registryImages.slice().reverse();
      if (cubeStudio.configured) {
        try {
          const remote = await cubeStudio.listImages();
          const remoteRows = remote.payload?.result?.data || [];
          const mapped = remoteRows.map((row) => {
            const target =
              String(row.name || "")
                .replace(/<[^>]+>/g, "")
                .trim() ||
              String(row.images_url || "")
                .replace(/<[^>]+>/g, "")
                .trim();
            return {
              id: `cube-image-${row.id}`,
              name: row.describe || target || `image-${row.id}`,
              target_image: target,
              immutable_ref: target || null,
              digest: null,
              provider: "cube-studio",
              evidence_level: "cube-studio-image-catalog",
              runtime_verified: false,
              status: "ready",
              created_at: row.modified || row.created_on || new Date().toISOString()
            };
          });
          const ids = new Set(mapped.map((item) => String(item.id)));
          data = [...mapped, ...data.filter((item) => !ids.has(String(item.id)))];
        } catch (error) {
          console.warn("同步 Cube Studio 镜像目录失败:", error);
        }
      }
      sendJson(response, 200, {
        result: {
          data,
          count: data.length
        }
      });
      return;
    }

    if (pathname === "/platform/pipeline-runs" && request.method === "POST") {
      const body = await readBody(request);
      let pipeline = findItem(store.pipelines, body.pipeline_id);
      // 真实 cube-studio：Pipeline 列表来自远端，本地 store 可能没有对应记录
      if (!pipeline && cubeStudio.configured && body.pipeline_id) {
        pipeline = {
          id: body.pipeline_id,
          name: body.pipeline_name || `pipeline-${body.pipeline_id}`,
          describe: body.pipeline_describe || ""
        };
      }
      if (!pipeline) {
        sendError(response, 404, "Pipeline 不存在");
        return;
      }
      await refreshPlatformJobs();
      const requestedImageIds = Array.isArray(body.image_ids) ? body.image_ids : [];
      let images = requestedImageIds
        .map((id) => findItem(store.registryImages, id))
        .filter(Boolean);
      // 也允许选择同步自 cube 的镜像（不在本地 store）
      if (images.length === 0 && requestedImageIds.length > 0 && cubeStudio.configured) {
        images = requestedImageIds.map((id) => ({
          id,
          name: String(id),
          digest: null,
          status: "ready",
          target_image: String(id)
        }));
      }
      if (!cubeStudio.configured) {
        if (images.length === 0) {
          sendError(response, 400, "至少选择一个已登记镜像后才能运行 Pipeline");
          return;
        }
        if (images.some((image) => image.status !== "ready")) {
          sendError(response, 409, "Pipeline 只能使用 ready 状态的镜像");
          return;
        }
      } else if (images.length === 0) {
        // Cube Studio 的 DAG 已绑定镜像；此处仅作运行提交记录
        images = [
          {
            id: "cube-dag-bound",
            name: "cube-studio-dag",
            digest: null,
            status: "ready",
            target_image: "cube-studio/pipeline-dag"
          }
        ];
      }
      const now = new Date().toISOString();
      let remote = null;
      if (cubeStudio.configured) {
        remote = await cubeStudio.runPipeline(pipeline.id);
      }
      const taskNames = [
        "解析 Pipeline DAG",
        "校验镜像与算法契约",
        "拉取容器镜像",
        "执行算法任务",
        "归档 MinIO 产物"
      ];
      const manifest = {
        schema_version: "robot-pipeline-run/v1",
        pipeline_id: pipeline.id,
        pipeline_name: pipeline.name,
        image_digests: images.map((image) => image.digest),
        parameters: body.parameters || {}
      };
      const run = {
        id: `pipeline-run-${randomUUID()}`,
        pipeline_id: pipeline.id,
        pipeline_name: pipeline.name,
        images,
        parameters: body.parameters || {},
        provider: cubeStudio.configured ? "cube-studio" : "local-compatible",
        evidence_level: cubeStudio.configured
          ? "cube-studio-submission"
          : "local-orchestration-rehearsal",
        run_manifest: {
          ...manifest,
          sha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
        },
        status: cubeStudio.configured ? "submitted" : "queued",
        phase: cubeStudio.configured ? "已提交 Cube Studio Argo Workflow" : "等待本地执行器",
        progress: cubeStudio.configured ? 5 : 0,
        tasks: taskNames.map((name) => ({ name, status: "queued" })),
        submitted_at: now,
        started_at: now,
        updated_at: now,
        duration_ms: 14000,
        remote_status: remote?.status || null,
        remote_location: remote?.location || null
      };
      store.pipelineRuns.push(run);
      await persistStore();
      sendJson(response, 201, { result: run });
      return;
    }

    if (pathname === "/platform/pipeline-runs" && request.method === "GET") {
      await refreshPlatformJobs();
      sendJson(response, 200, {
        result: {
          data: store.pipelineRuns.slice().reverse(),
          count: store.pipelineRuns.length
        }
      });
      return;
    }

    const pipelineRunMatch = pathname.match(/^\/platform\/pipeline-runs\/([^/]+)$/);
    if (pipelineRunMatch && request.method === "GET") {
      await refreshPlatformJobs();
      const run = findItem(store.pipelineRuns, decodeURIComponent(pipelineRunMatch[1]));
      if (!run) {
        sendError(response, 404, "Pipeline 运行不存在");
        return;
      }
      sendJson(response, 200, { result: run });
      return;
    }

    if (pathname === "/platform/artifacts" && request.method === "GET") {
      await refreshPlatformJobs();
      sendJson(response, 200, {
        result: {
          data: store.artifacts.slice().reverse(),
          count: store.artifacts.length
        }
      });
      return;
    }

    const artifactContentMatch = pathname.match(
      /^\/platform\/artifacts\/([^/]+)\/content$/
    );
    if (artifactContentMatch && request.method === "GET") {
      const artifact = findItem(store.artifacts, decodeURIComponent(artifactContentMatch[1]));
      if (!artifact) {
        sendError(response, 404, "产物不存在");
        return;
      }
      const content = await artifactStore.readObject(artifact);
      const filename = String(artifact.name || "artifact.json").replace(/[^a-zA-Z0-9._-]/g, "_");
      response.writeHead(200, {
        "Content-Type": artifact.content_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`
      });
      response.end(content);
      return;
    }

    if (pathname === "/deploy" && request.method === "POST") {
      const body = await readBody(request);
      const deployment = {
        id: store.deployments.length + 1,
        ...body,
        status: "running",
        created_at: new Date().toISOString(),
        message: `算法 ${body.service || "unknown"} 已在本地轻量后端完成模拟部署`
      };
      store.deployments.push(deployment);
      await persistStore();
      sendJson(response, 201, { result: deployment });
      return;
    }

    if (pathname === "/deployments" && request.method === "GET") {
      sendJson(response, 200, { result: { data: store.deployments } });
      return;
    }

    if (pathname === "/simulation/scenarios" && request.method === "GET") {
      sendJson(response, 200, {
        result: {
          data: Object.values(sceneProfiles).map((scene) => ({
            id: scene.id,
            label: scene.label,
            version: scene.version,
            compatible_robot_kinds: scene.compatible_robot_kinds,
            minimum_robots: scene.minimum_robots || 1
          }))
        }
      });
      return;
    }

    if (pathname === "/simulation/preflight" && request.method === "POST") {
      const body = await readBody(request);
      const requestedAlgorithms = Array.isArray(body.algorithms) ? body.algorithms : [];
      if (requestedAlgorithms.length === 0) {
        sendError(response, 400, "至少需要一个仿真算法容器");
        return;
      }
      const resolution = resolveSimulationAlgorithms(requestedAlgorithms);
      const pipeline = body.pipeline_id ? findItem(store.pipelines, body.pipeline_id) : null;
      const bindingErrors = [...resolution.errors];
      if (body.pipeline_id && !pipeline) {
        bindingErrors.push("画布中选择的 Pipeline 不存在");
      } else if (
        pipeline?.algorithm_ids?.length &&
        !resolution.algorithms.every((algorithm) =>
          pipeline.algorithm_ids.some((id) => String(id) === String(algorithm.id))
        )
      ) {
        bindingErrors.push("所选算法不属于当前画布绑定的 Pipeline");
      }
      if (
        pipeline?.recommended_robot_ids?.length &&
        !pipeline.recommended_robot_ids.some((id) => String(id) === String(body.robot?.id || ""))
      ) {
        const recommendedNames = pipeline.recommended_robot_ids
          .map((id) => findItem(store.robots, id)?.name)
          .filter(Boolean)
          .join("、");
        bindingErrors.push(`当前 Pipeline 需要机器人：${recommendedNames || pipeline.recommended_robot_ids.join("、")}`);
      }
      sendJson(response, 200, {
        result: buildCompatibilityReport(
          resolution.algorithms,
          body.scene || "warehouse",
          body.robot,
          bindingErrors
        )
      });
      return;
    }

    if (pathname === "/simulation/run" && request.method === "POST") {
      const body = await readBody(request);
      const requestedAlgorithms = Array.isArray(body.algorithms) ? body.algorithms : [];
      if (requestedAlgorithms.length === 0) {
        sendError(response, 400, "至少需要一个仿真算法容器");
        return;
      }

      const resolution = resolveSimulationAlgorithms(requestedAlgorithms);
      const resolvedAlgorithms = resolution.algorithms;
      const registeredRobot = body.robot?.id ? findItem(store.robots, body.robot.id) : null;
      const pipeline = body.pipeline_id ? findItem(store.pipelines, body.pipeline_id) : null;
      const runErrors = [...resolution.errors];
      if (
        pipeline?.recommended_robot_ids?.length &&
        !pipeline.recommended_robot_ids.some((id) => String(id) === String(registeredRobot?.id || ""))
      ) {
        const recommendedNames = pipeline.recommended_robot_ids
          .map((id) => findItem(store.robots, id)?.name)
          .filter(Boolean)
          .join("、");
        runErrors.push(`当前 Pipeline 需要机器人：${recommendedNames || pipeline.recommended_robot_ids.join("、")}`);
      }
      const compatibility = buildCompatibilityReport(
        resolvedAlgorithms,
        body.scene || "warehouse",
        registeredRobot || body.robot,
        runErrors
      );
      if (!compatibility.runnable) {
        sendJson(response, 422, {
          message: "仿真预检失败",
          status: 422,
          result: compatibility
        });
        return;
      }
      const now = new Date();
      const requestedSeed = Number(body.seed);
      const seed = Number.isInteger(requestedSeed) ? Math.abs(requestedSeed) : 20260724;
      const faultMode = ["none", "sensor-dropout", "algorithm-timeout"].includes(body.fault_mode)
        ? body.fault_mode
        : "none";
      const workflowName = body.workflow_name || "未命名仿真工作流";
      const scene = body.scene || "warehouse";
      if (body.pipeline_id && !pipeline) {
        sendError(response, 404, "画布中选择的 Pipeline 不存在");
        return;
      }
      if (
        pipeline?.algorithm_ids?.length &&
        !resolvedAlgorithms.every((algorithm) =>
          pipeline.algorithm_ids.some((id) => String(id) === String(algorithm.id))
        )
      ) {
        sendError(response, 422, "画布中的算法不属于所选 Pipeline");
        return;
      }
      const workflowManifest =
        pipeline?.workflow_manifest ||
        resolvedAlgorithms.find((algorithm) => algorithm.workflow_manifest)?.workflow_manifest ||
        null;
      const isArgoWorkflow =
        compatibility.execution_mode === "cube-studio-argo" && Boolean(workflowManifest);
      if (!isArgoWorkflow) {
        sendError(response, 422, "生产运行只接受绑定不可变 OCI 镜像的真实 Cube Studio / Argo Workflow");
        return;
      }
      if (isArgoWorkflow && faultMode !== "none") {
        sendError(response, 400, "真实 Cube Studio 闭环暂不支持页面故障注入，请选择“无故障注入”");
        return;
      }
      const baseRunManifest = buildRunManifest({
        workflowName,
        scene,
        robot: registeredRobot,
        algorithms: resolvedAlgorithms,
        seed,
        faultMode
      });
      const remoteWorkflow = await submitArgoWorkflow(workflowManifest);
      const manifestSpec = {
        ...baseRunManifest,
        pipeline_id: pipeline?.id || null,
        workflow_manifest: remoteWorkflow.manifest_path,
        remote_workflow: remoteWorkflow
      };
      const { sha256: _ignoredManifestHash, ...manifestWithoutHash } = manifestSpec;
      const runManifest = {
        ...manifestWithoutHash,
        sha256: createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex")
      };
      const run = {
        id: `sim-${randomUUID()}`,
        workflow_name: workflowName,
        robot: registeredRobot,
        algorithms: resolvedAlgorithms,
        scene,
        scenario: {
          id: scene,
          version: sceneProfiles[scene].version,
          seed,
          fault_mode: faultMode
        },
        run_manifest: runManifest,
        status: "running",
        progress: 0,
        execution_mode: "cube-studio-argo",
        provider: {
          id: "cube-studio-argo",
          label: "真实 Cube Studio / Argo Workflow",
          evidence_level: "runtime-verified",
          capabilities: ["start", "events", "artifact"]
        },
        pipeline_id: pipeline?.id || null,
        remote_workflow: remoteWorkflow,
        compatibility,
        container_states: resolvedAlgorithms.map((algorithm) => ({
          id: algorithm.id,
          name: algorithm.name,
          status: "queued"
        })),
        started_at: now.toISOString(),
        updated_at: now.toISOString(),
        last_resumed_at: null,
        duration_ms: 12000,
        accumulated_ms: 0,
        elapsed_ms: 0,
        revision: 1,
        events: [],
        metrics: {}
      };
      appendRunEvent(run, "preflight", `严格接口预检通过，兼容性评分 ${compatibility.score}`);
      appendRunEvent(
        run,
        "run",
        `已提交真实 Cube Studio Argo Workflow ${remoteWorkflow.name}`,
        { namespace: remoteWorkflow.namespace, uid: remoteWorkflow.uid }
      );
      appendRunEvent(
        run,
        "evidence",
        "将以容器运行结果、自动断言、SHA-256 校验和 MinIO 产物作为闭环证据",
        { manifest_sha256: runManifest.sha256 }
      );
      store.simulationRuns.push(run);
      await persistStore();
      sendJson(response, 201, {
        result: url.searchParams.get("view") === "deployment"
          ? sanitizeDeploymentRun(run)
          : run
      });
      return;
    }

    if (pathname === "/simulation/runs" && request.method === "GET") {
      let shouldPersist = false;
      for (const run of store.simulationRuns) {
        const previousStatus = run.status;
        const changed = await refreshSimulationRun(run);
        if (changed || previousStatus !== run.status) shouldPersist = true;
      }
      if (shouldPersist) await persistStore();
      const statusFilter = url.searchParams.get("status");
      const requestedLimit = Number(url.searchParams.get("limit") || 50);
      const limit = Math.max(
        1,
        Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 50)
      );
      const productionRuns = store.simulationRuns.filter(
        (run) => run.execution_mode === "cube-studio-argo"
      );
      const filteredRuns = statusFilter
        ? productionRuns.filter((run) => run.status === statusFilter)
        : productionRuns;
      sendJson(response, 200, {
        result: {
          data: filteredRuns.slice().reverse().slice(0, limit).map(compactRunForList),
          count: filteredRuns.length,
          limit
        }
      });
      return;
    }

    const simulationRunMatch = pathname.match(/^\/simulation\/runs\/([^/]+)$/);
    if (simulationRunMatch && request.method === "GET") {
      const run = findItem(store.simulationRuns, decodeURIComponent(simulationRunMatch[1]));
      if (!run) {
        sendError(response, 404, "仿真运行记录不存在");
        return;
      }
      const previousStatus = run.status;
      const changed = await refreshSimulationRun(run);
      await hydratePhysicsPlayback(run);
      if (changed || previousStatus !== run.status) {
        await persistStore();
      }
      sendJson(response, 200, {
        result: url.searchParams.get("view") === "deployment"
          ? sanitizeDeploymentRun(run)
          : run
      });
      return;
    }

    const simulationFrameMatch = pathname.match(
      /^\/simulation\/runs\/([^/]+)\/frames\/(\d+)$/
    );
    if (simulationFrameMatch && request.method === "GET") {
      const run = findItem(store.simulationRuns, decodeURIComponent(simulationFrameMatch[1]));
      const frameIndex = Number(simulationFrameMatch[2]);
      if (!run || run.evidence?.kind !== "physics-simulation" || !run.evidence?.artifact_key) {
        sendError(response, 404, "物理渲染证据不存在");
        return;
      }
      const frameCount = Number(run.evidence.rendered_frames?.count || 0);
      if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frameCount) {
        sendError(response, 404, "物理渲染帧不存在");
        return;
      }
      const archive = await artifactStore.readWorkflowKey(run.evidence.artifact_key);
      const frame = extractTarEntry(
        archive,
        `frames/frame-${String(frameIndex).padStart(3, "0")}.png`
      );
      setCommonHeaders(response);
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": frame.length,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(frame);
      return;
    }

    const retailAssetMatch = pathname.match(
      /^\/simulation\/runs\/([^/]+)\/(scene-mesh|preview)$/
    );
    if (retailAssetMatch && request.method === "GET") {
      const run = findItem(store.simulationRuns, decodeURIComponent(retailAssetMatch[1]));
      if (!run || run.evidence?.kind !== "retail-digital-twin" || !run.evidence?.artifact_key) {
        sendError(response, 404, "便利店数字孪生证据不存在");
        return;
      }
      const isMesh = retailAssetMatch[2] === "scene-mesh";
      const archive = await artifactStore.readWorkflowKey(run.evidence.artifact_key);
      const asset = extractTarEntry(archive, isMesh ? "retail-store.obj" : "preview.png");
      setCommonHeaders(response);
      response.writeHead(200, {
        "Content-Type": isMesh ? "text/plain; charset=utf-8" : "image/png",
        "Content-Length": asset.length,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(asset);
      return;
    }

    const visualAssetMatch = pathname.match(
      /^\/simulation\/runs\/([^/]+)\/(visual-input|visual-output|edge-input|edge-output)$/
    );
    if (visualAssetMatch && request.method === "GET") {
      const run = findItem(store.simulationRuns, decodeURIComponent(visualAssetMatch[1]));
      if (!run || !run.evidence?.artifact_key) {
        sendError(response, 404, "二维视觉运行证据不存在");
        return;
      }
      const isInput = visualAssetMatch[2].endsWith("input");
      const legacyAsset = run.evidence.kind === "image-edge-detection"
        ? (isInput ? { path: "input.png", format: "PNG" } : { path: "edge.png", format: "PNG" })
        : run.evidence.kind === "barcode-recognition" && isInput
          ? { path: "input.png", format: "PNG" }
          : null;
      const declaredAsset = run.evidence.visual_assets?.[isInput ? "input" : "output"] || legacyAsset;
      if (!declaredAsset?.path) {
        sendError(response, 404, isInput ? "本次运行未归档原始输入图" : "本次运行未归档可视化输出图");
        return;
      }
      const archive = await artifactStore.readWorkflowKey(run.evidence.artifact_key);
      const asset = extractTarEntry(archive, declaredAsset.path);
      const contentType = /\.jpe?g$/i.test(declaredAsset.path) ? "image/jpeg" : "image/png";
      setCommonHeaders(response);
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": asset.length,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(asset);
      return;
    }

    if (simulationRunMatch && request.method === "PUT") {
      sendError(response, 405, "运行事实不可由客户端覆盖，请使用 pause/resume/cancel 控制端点");
      return;
    }

    const simulationControlMatch = pathname.match(
      /^\/simulation\/runs\/([^/]+)\/control$/
    );
    if (simulationControlMatch && request.method === "POST") {
      const run = findItem(store.simulationRuns, decodeURIComponent(simulationControlMatch[1]));
      if (!run) {
        sendError(response, 404, "仿真运行记录不存在");
        return;
      }
      const body = await readBody(request);
      if (body.action !== "cancel") {
        sendError(response, 400, "真实 Workflow 当前只支持 cancel；暂停与恢复必须由算法检查点协议显式实现");
        return;
      }
      if (run.execution_mode !== "cube-studio-argo" || !run.remote_workflow?.name) {
        sendError(response, 409, "平台不再支持合成运行控制，只能停止真实 Argo Workflow");
        return;
      }
      if (
        !Number.isInteger(body.expected_revision) ||
        body.expected_revision !== Number(run.revision || 0)
      ) {
        sendError(response, 409, `运行版本冲突：当前 revision=${run.revision || 0}`);
        return;
      }
      if (!["running", "starting", "interrupted"].includes(run.status)) {
        sendError(response, 409, `状态 ${run.status} 不允许停止`);
        return;
      }
      const liveWorkflow = await kubernetesClient.getWorkflow(
        run.remote_workflow.namespace,
        run.remote_workflow.name
      );
      if (!["Pending", "Running"].includes(liveWorkflow.status?.phase || "Pending")) {
        await updateArgoRun(run);
        await persistStore();
        sendError(response, 409, `Workflow 已进入 ${liveWorkflow.status?.phase}，不能再终止`);
        return;
      }
      await kubernetesClient.deleteWorkflow(
        run.remote_workflow.namespace,
        run.remote_workflow.name
      );
      const now = new Date().toISOString();
      run.status = "canceled";
      run.cancel_requested_at = now;
      run.finished_at = now;
      run.updated_at = now;
      run.container_states = run.container_states.map((state) => ({
        ...state,
        status: "canceled"
      }));
      run.outcome = {
        code: "cube-studio-workflow-canceled",
        validation_result: "not_evaluated",
        publishable: false,
        reason: "用户已通过平台终止真实 Argo Workflow；未生成可发布证据"
      };
      appendRunEvent(run, "control", run.outcome.reason, {
        namespace: run.remote_workflow.namespace,
        workflow: run.remote_workflow.name,
        propagation_policy: "Background"
      });
      run.revision = Number(run.revision || 0) + 1;
      await persistStore();
      sendJson(response, 200, {
        result: url.searchParams.get("view") === "deployment"
          ? sanitizeDeploymentRun(run)
          : run
      });
      return;
    }

    if (pathname === "/robot-design/generate" && request.method === "POST") {
      const body = await readBody(request);
      const type = body.type === "lower" ? "lower" : "upper";
      const params = body.params || {};
      const timestamp = Date.now();
      const parts = Array.from({ length: 12 }, (_, index) => {
        const variation = (index - 5.5) / 50;
        const robotId = `local-${type}-${timestamp}-${index + 1}`;
        return {
          robot_id: robotId,
          name: `${type === "upper" ? "上半身" : "下半身"}方案-${index + 1}`,
          xml_path: `/local-models/${robotId}.xml`,
          arm_parameters: type === "upper"
            ? {
                length: Number(params.workRadius || 1.1) + variation,
                mass: Number(params.weight || 6.5) + variation,
                load: Number(params.payload || 3),
                dofs: Number(params.dof || 5)
              }
            : undefined,
          base_parameters: type === "lower"
            ? {
                velocity: Number(params.speed || 3) + variation,
                mass: Number(params.weight || 37.5) + variation,
                load: Number(params.payload || 27.5),
                dofs: Number(params.dof || 5)
              }
            : undefined
        };
      });
      sendJson(response, 201, { result: { type, parts } });
      return;
    }

    if (pathname === "/robot-design/assemble" && request.method === "POST") {
      const body = await readBody(request);
      const robotId = `local-assembled-${Date.now()}`;
      sendJson(response, 201, {
        result: {
          robot_id: robotId,
          name: "本地组合机器人",
          description: `由 ${body.up_id || "上半身"} 与 ${body.down_id || "下半身"} 拼接`,
          xml_path: `/local-models/${robotId}.xml`
        }
      });
      return;
    }

    if (pathname === "/get_image" && request.method === "GET") {
      const modelPath = url.searchParams.get("model_path") || "local-model";
      const safeLabel = modelPath.replace(/[<>&"']/g, "").slice(-36);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#0f172a"/>
              <stop offset="1" stop-color="#1d4ed8"/>
            </linearGradient>
          </defs>
          <rect width="800" height="600" fill="url(#bg)"/>
          <g fill="none" stroke="#60a5fa" stroke-width="18" stroke-linecap="round">
            <rect x="285" y="145" width="230" height="170" rx="48"/>
            <path d="M330 315v130M470 315v130M285 350l-90 70M515 350l90 70"/>
          </g>
          <g fill="#bfdbfe">
            <circle cx="355" cy="225" r="18"/>
            <circle cx="445" cy="225" r="18"/>
          </g>
          <text x="400" y="520" text-anchor="middle" fill="#e0f2fe" font-size="26" font-family="sans-serif">${safeLabel}</text>
        </svg>`;
      response.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8" });
      response.end(svg);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(response, pathname);
      return;
    }

    sendError(response, 404, "接口不存在");
  } catch (error) {
    console.error(error);
    sendError(response, 500, error instanceof Error ? error.message : "服务器内部错误");
  }
});

server.listen(port, host, () => {
  console.log(`Lightweight Cube Studio backend: http://${host}:${port}`);
  console.log(`Health check: http://${host}:${port}/health`);
});
