import http from "node:http";
import { copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactStore,
  cubeStudio,
  platformConfiguration
} from "./platform-services.mjs";

const currentFile = fileURLToPath(import.meta.url);
const backendDir = path.dirname(currentFile);
const projectDir = path.resolve(backendDir, "..");
const staticDir = path.join(projectDir, "dist");
const dataFile = path.join(backendDir, "data.json");
const dataBackupFile = path.join(backendDir, "data.json.bak");
const dataTempFile = path.join(backendDir, "data.json.tmp");
const catalogFile = path.join(backendDir, "open-source-catalog.json");
const port = Number(process.env.PORT || 3001);
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

const bootedAt = new Date().toISOString();
for (const run of store.simulationRuns) {
  if (run.status === "running" || run.status === "paused") {
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

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
  const snapshot = `${JSON.stringify(store, null, 2)}\n`;
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
      "/camera/image_raw": "sensor_msgs/msg/Image",
      "/camera/camera_info": "sensor_msgs/msg/CameraInfo"
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
      warnings.push(
        `${algorithm.name} 仅在合成编排演练中展示；真实 Docker/Gazebo 运行前必须完成 CI 构建与制品审查`
      );
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
  return {
    runnable: errors.length === 0,
    score,
    scene,
    scene_version: sceneProfile?.version || null,
    scene_label: sceneProfile?.label || scene,
    robot_profile: robotProfile,
    execution_mode: "browser-orchestration-rehearsal",
    evidence_level: "synthetic",
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
    execution_mode: "browser-orchestration-rehearsal",
    evidence_level: "synthetic",
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

function metric(value, unit, timestamp) {
  return {
    value,
    unit,
    source: "synthetic-orchestration",
    timestamp,
    trustworthy: false
  };
}

function updateMockRun(run, nowMs = Date.now()) {
  if (run.status !== "running") return false;
  const durationMs = Number(run.duration_ms || 12000);
  const resumedAtMs = Date.parse(run.last_resumed_at || run.started_at);
  const activeMs = Number.isFinite(resumedAtMs) ? Math.max(0, nowMs - resumedAtMs) : 0;
  const elapsedMs = Math.min(durationMs, Number(run.accumulated_ms || 0) + activeMs);
  const nextProgress = Math.min(100, Math.floor((elapsedMs / durationMs) * 100));
  const previousProgress = Number(run.progress || 0);
  const timestamp = new Date(nowMs).toISOString();

  run.elapsed_ms = elapsedMs;
  run.progress = nextProgress;
  run.updated_at = timestamp;
  run.pose = {
    x: Number((nextProgress * 0.08).toFixed(2)),
    y: Number((Math.sin(nextProgress / 12) * 1.8).toFixed(2)),
    heading: Number((Math.sin(nextProgress / 18) * 0.35).toFixed(2)),
    source: "synthetic-orchestration",
    trustworthy: false,
    timestamp
  };
  run.metrics = {
    rehearsal_rate: metric(
      Number((0.95 + Math.sin(nextProgress / 13) * 0.02).toFixed(2)),
      "x",
      timestamp
    ),
    collision_count: metric(null, "not_measured", timestamp),
    cpu_usage: metric(null, "not_measured", timestamp),
    memory_usage: metric(null, "not_measured", timestamp),
    sim_time: metric(Number((elapsedMs / 1000).toFixed(1)), "s", timestamp)
  };
  run.container_states = run.algorithms.map((algorithm, index) => ({
    id: algorithm.id,
    name: algorithm.name,
    status:
      nextProgress >= 100
        ? "completed"
        : nextProgress < 10 + index * 3
          ? "pulling"
          : nextProgress < 24 + index * 3
            ? "starting"
            : "running"
  }));

  const faultMode = run.scenario?.fault_mode || "none";
  if (faultMode !== "none" && previousProgress < 55 && nextProgress >= 55) {
    const faultMessages = {
      "sensor-dropout": "合成传感器中断已触发安全停止",
      "algorithm-timeout": "合成算法超时已触发运行终止"
    };
    run.status = "failed";
    run.last_resumed_at = null;
    run.finished_at = timestamp;
    run.failure_reason = faultMessages[faultMode] || `故障演练 ${faultMode} 已触发`;
    run.container_states = run.container_states.map((state, index) => ({
      ...state,
      status: index === 0 ? "failed" : "canceled"
    }));
    run.outcome = {
      code: `synthetic-${faultMode}`,
      validation_result: "rehearsal_assertion_failed",
      publishable: false,
      reason: run.failure_reason
    };
    appendRunEvent(run, "assertion_failed", run.failure_reason, {
      progress: nextProgress,
      evidence_level: "synthetic",
      seed: run.scenario?.seed
    });
    run.revision = Number(run.revision || 0) + 1;
    return true;
  }

  const milestones = [
    [20, "perception", "合成传感器数据流已建立"],
    [45, "planning", "合成路径事件已生成（非真实规划证据）"],
    [70, "control", "合成轨迹控制事件正在推进"],
    [100, "result", "编排演练完成；未执行物理仿真验收"]
  ];
  for (const [threshold, type, message] of milestones) {
    if (previousProgress < threshold && nextProgress >= threshold) {
      appendRunEvent(run, type, message, { progress: threshold, evidence_level: "synthetic" });
    }
  }

  if (nextProgress >= 100) {
    run.status = "completed";
    run.progress = 100;
    run.elapsed_ms = durationMs;
    run.accumulated_ms = durationMs;
    run.last_resumed_at = null;
    run.finished_at = timestamp;
    run.outcome = {
      code: "orchestration-rehearsal-completed",
      validation_result: "not_evaluated",
      publishable: false,
      reason: "该运行只产生合成数字孪生事件，未连接 ROS 2/Gazebo 执行器"
    };
    run.revision = Number(run.revision || 0) + 1;
  }
  return nextProgress !== previousProgress || run.status === "completed";
}

function controlMockRun(run, action, expectedRevision) {
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision !== Number(run.revision || 0)
  ) {
    return {
      ok: false,
      status: 409,
      message: `运行版本冲突：当前 revision=${run.revision || 0}`
    };
  }
  const nowMs = Date.now();
  updateMockRun(run, nowMs);
  const now = new Date(nowMs).toISOString();

  if (action === "pause" && run.status === "running") {
    run.status = "paused";
    run.accumulated_ms = Number(run.elapsed_ms || 0);
    run.last_resumed_at = null;
    run.container_states = run.container_states.map((state) => ({ ...state, status: "paused" }));
    appendRunEvent(run, "control", `运行已在 ${run.progress}% 暂停`);
  } else if (action === "resume" && run.status === "paused") {
    run.status = "running";
    run.last_resumed_at = now;
    run.container_states = run.container_states.map((state) => ({ ...state, status: "running" }));
    appendRunEvent(run, "control", "运行已恢复");
  } else if (action === "cancel" && ["running", "paused"].includes(run.status)) {
    run.status = "canceled";
    run.accumulated_ms = Number(run.elapsed_ms || 0);
    run.last_resumed_at = null;
    run.finished_at = now;
    run.container_states = run.container_states.map((state) => ({ ...state, status: "canceled" }));
    run.outcome = {
      code: "canceled",
      validation_result: "not_evaluated",
      publishable: false
    };
    appendRunEvent(run, "control", "运行已取消");
  } else {
    return {
      ok: false,
      status: 409,
      message: `状态 ${run.status} 不允许执行 ${action}`
    };
  }

  run.updated_at = now;
  run.revision = Number(run.revision || 0) + 1;
  return { ok: true };
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
  return localSessions[token] || null;
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
    "/robot-design/"
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
    if (pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        backend: "cube-studio-compatible-lite",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/login/" && request.method === "POST") {
      const body = await readBody(request);
      const accounts = {
        admin: "admin123",
        demo: "demo123"
      };
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
      sendJson(response, 200, {
        result: {
          data: store.registryRepositories,
          count: store.registryRepositories.length
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
      sendJson(response, 200, {
        result: {
          data: store.imageBuilds.slice().reverse(),
          count: store.imageBuilds.length
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
      sendJson(response, 200, {
        result: {
          data: store.registryImages.slice().reverse(),
          count: store.registryImages.length
        }
      });
      return;
    }

    if (pathname === "/platform/pipeline-runs" && request.method === "POST") {
      const body = await readBody(request);
      const pipeline = findItem(store.pipelines, body.pipeline_id);
      if (!pipeline) {
        sendError(response, 404, "Pipeline 不存在");
        return;
      }
      await refreshPlatformJobs();
      const requestedImageIds = Array.isArray(body.image_ids) ? body.image_ids : [];
      const images = requestedImageIds
        .map((id) => findItem(store.registryImages, id))
        .filter(Boolean);
      if (images.length === 0) {
        sendError(response, 400, "至少选择一个已登记镜像后才能运行 Pipeline");
        return;
      }
      if (images.some((image) => image.status !== "ready")) {
        sendError(response, 409, "Pipeline 只能使用 ready 状态的镜像");
        return;
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
      sendJson(response, 200, {
        result: buildCompatibilityReport(
          resolution.algorithms,
          body.scene || "warehouse",
          body.robot,
          resolution.errors
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
      const compatibility = buildCompatibilityReport(
        resolvedAlgorithms,
        body.scene || "warehouse",
        registeredRobot || body.robot,
        resolution.errors
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
      const runManifest = buildRunManifest({
        workflowName,
        scene,
        robot: registeredRobot,
        algorithms: resolvedAlgorithms,
        seed,
        faultMode
      });
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
        execution_mode: compatibility.execution_mode,
        provider: {
          id: "browser-orchestration-rehearsal",
          label: "服务端确定性编排演练",
          evidence_level: "synthetic",
          capabilities: ["start", "pause", "resume", "cancel", "events"]
        },
        compatibility,
        container_states: resolvedAlgorithms.map((algorithm) => ({
          id: algorithm.id,
          name: algorithm.name,
          status: "queued"
        })),
        started_at: now.toISOString(),
        updated_at: now.toISOString(),
        last_resumed_at: now.toISOString(),
        duration_ms: 12000,
        accumulated_ms: 0,
        elapsed_ms: 0,
        revision: 1,
        events: [],
        metrics: {
          rehearsal_rate: metric(0, "x", now.toISOString()),
          collision_count: metric(null, "not_measured", now.toISOString()),
          cpu_usage: metric(null, "not_measured", now.toISOString()),
          memory_usage: metric(null, "not_measured", now.toISOString()),
          sim_time: metric(0, "s", now.toISOString())
        }
      };
      appendRunEvent(run, "preflight", `严格接口预检通过，兼容性评分 ${compatibility.score}`);
      appendRunEvent(run, "run", `已创建服务端权威运行 ${run.id}`);
      appendRunEvent(
        run,
        "evidence",
        "当前 provider 只产生合成编排证据，不代表 ROS 2/Gazebo 算法验证",
        { manifest_sha256: runManifest.sha256, seed, fault_mode: faultMode }
      );
      store.simulationRuns.push(run);
      await persistStore();
      sendJson(response, 201, { result: run });
      return;
    }

    if (pathname === "/simulation/runs" && request.method === "GET") {
      let shouldPersist = false;
      for (const run of store.simulationRuns) {
        const previousStatus = run.status;
        const changed = updateMockRun(run);
        if (changed && previousStatus !== run.status) shouldPersist = true;
      }
      if (shouldPersist) await persistStore();
      const statusFilter = url.searchParams.get("status");
      const requestedLimit = Number(url.searchParams.get("limit") || 50);
      const limit = Math.max(
        1,
        Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 50)
      );
      const filteredRuns = statusFilter
        ? store.simulationRuns.filter((run) => run.status === statusFilter)
        : store.simulationRuns;
      sendJson(response, 200, {
        result: {
          data: filteredRuns.slice().reverse().slice(0, limit),
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
      const changed = updateMockRun(run);
      if (changed && previousStatus !== run.status) {
        await persistStore();
      }
      sendJson(response, 200, { result: run });
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
      if (!["pause", "resume", "cancel"].includes(body.action)) {
        sendError(response, 400, "action 只能是 pause、resume 或 cancel");
        return;
      }
      const controlResult = controlMockRun(run, body.action, body.expected_revision);
      if (!controlResult.ok) {
        sendError(response, controlResult.status || 409, controlResult.message);
        return;
      }
      await persistStore();
      sendJson(response, 200, { result: run });
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
