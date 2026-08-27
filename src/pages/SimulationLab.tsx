import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronRight,
  Container,
  Download,
  ExternalLink,
  Gauge,
  GripVertical,
  History,
  MonitorPlay,
  PackageSearch,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  StopCircle,
  Store,
  Terminal,
  Trash2,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PhysicsKeyframe } from "@/components/simulation/PhysicsSimulationViewport";
import MappingQualificationViewport from "@/components/simulation/MappingQualificationViewport";
import VisualEvidenceViewport from "@/components/simulation/VisualEvidenceViewport";
import { useToast } from "@/hooks/use-toast";
import { buildApiUrl, getAuthHeaders, platformApi, resourceApi, simulationAlgorithmApi, simulationApi } from "@/services/api";
import "./SimulationLab.css";

const PhysicsSimulationViewport = lazy(() => import("@/components/simulation/PhysicsSimulationViewport"));

interface SimulationAlgorithm {
  id: string | number;
  catalog_key?: string;
  name: string;
  module: string;
  version: string;
  image: string;
  command: string;
  runtime: string;
  inputs: string[];
  outputs: string[];
  description: string;
  status: string;
  color: string;
  repository_url?: string;
  license?: string;
  verified_commit?: string;
  image_status?: string;
  execution_adapter?: string;
  workflow_manifest?: string;
  evidence_kind?: "barcode-recognition" | "physics-simulation" | "retail-digital-twin" | "image-edge-detection" | "ocr-recognition" | "image-classification" | "mapping-runtime-qualification";
}

interface Robot {
  id: string | number;
  name: string;
  model: string;
}

interface SimulationWorkflow {
  name?: string;
  pipelineId?: string | number;
  algorithms?: Array<{
    id?: string | number;
    assetId?: string | number;
    name: string;
    displayName?: string;
  } | string>;
  robots?: Array<{ id?: string | number; name: string }>;
  monitoringData?: unknown;
}

interface SimulationScenario {
  id: string;
  label: string;
  version: string;
}

type SimulationStatus =
  | "idle"
  | "validating"
  | "running"
  | "canceling"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

interface CompatibilityReport {
  runnable: boolean;
  qualification_only?: boolean;
  publishable_candidate?: boolean;
  score: number;
  execution_mode: string;
  evidence_level: string;
  errors: string[];
  warnings: string[];
  steps: Array<{
    id: string | number;
    name: string;
    missing_inputs: string[];
    adapter: string;
  }>;
}

interface MetricValue {
  value: number | null;
  unit: string;
  source: string;
  timestamp: string;
  trustworthy: boolean;
}

interface SimulationRun {
  id: string;
  status: Exclude<SimulationStatus, "idle" | "validating" | "failed"> | "failed";
  progress: number;
  revision: number;
  workflow_name?: string;
  pipeline_id?: string | number;
  started_at?: string;
  finished_at?: string;
  execution_mode?: string;
  artifact_id?: string | number;
  last_sync_error?: string;
  remote_workflow?: { name?: string; namespace?: string };
  robot?: Robot;
  algorithms?: SimulationAlgorithm[];
  scene?: string;
  provider?: { id: string; label: string; evidence_level: string; capabilities?: string[] };
  scenario?: { id: string; version: string; seed: number; fault_mode?: string };
  run_manifest?: { sha256: string };
  metrics?: Record<string, MetricValue>;
  pose?: {
    x: number;
    y: number;
    heading: number;
    source: string;
    trustworthy: boolean;
  };
  events?: Array<{ seq: number; type: string; message: string }>;
  container_states?: Array<{ id: string | number; name: string; status: string }>;
  outcome?: {
    code: string;
    validation_result: string;
    publishable: boolean;
    reason?: string;
  };
  evidence?: {
    kind?: "barcode-recognition" | "physics-simulation" | "retail-digital-twin" | "image-edge-detection" | "ocr-recognition" | "image-classification" | "mapping-runtime-qualification";
    artifact_key: string;
    expected_barcode?: string;
    detected_barcode?: string;
    barcode_format?: string;
    input_sha256?: string;
    upstream_commit?: string;
    elapsed_ms?: number;
    found?: number;
    engine?: { name?: string; version?: string; time_step_seconds?: number };
    algorithm?: { name?: string; source?: string; commit?: string };
    assertions?: Record<string, boolean>;
    metrics?: {
      simulation_steps?: number;
      simulated_seconds?: number;
      real_time_factor?: number;
      final_position_error_m?: number;
      object_transfer_distance_m?: number;
      safety_contact_steps?: number;
      width_px?: number;
      height_px?: number;
      edge_mean?: number;
      radius?: number;
    };
    playback?: { keyframe_count?: number; keyframes?: PhysicsKeyframe[] };
    rendered_frames?: { count?: number; renderer?: string };
    validation_profile?: string;
    full_stack_ready?: boolean;
    input?: { source?: string; point_count?: number; sha256?: string };
    scene?: {
      name?: string;
      mesh?: { format?: string; voxel_count?: number; vertices?: number; faces?: number };
    };
    perception?: { detection_count?: number };
    task?: {
      planner?: string;
      graph?: Array<{ id: string; layer: string; executor: string; status: string; reason?: string }>;
    };
    navigation?: {
      planner?: string;
      path_points?: number;
      path_length_m?: number;
      waypoints?: number[][];
    };
    manipulation?: {
      method?: string;
      reachable?: boolean;
      vla?: { status?: string; required?: string[] };
    };
    blockers?: string[];
    publishable?: boolean;
    required_fix?: string[];
    runtime?: {
      declared_platform?: string;
      container_arch?: string;
      payload_binary_arch?: string;
      python_version?: string;
      ros2_available?: boolean;
      numpy_available?: boolean;
    };
    delivery?: {
      source_file_count?: number;
      model_path?: string;
      model_bytes?: number;
      dataset_count?: number;
    };
    probe?: { started?: boolean; exit_code?: number | null; error?: string | null; output?: string };
    mesh_asset?: { path?: string; format?: string };
    preview_asset?: { path?: string; format?: string };
    input_asset?: { path?: string; format?: string };
    edge_asset?: { path?: string; format?: string };
    visual_assets?: {
      input?: { path?: string; format?: string; source?: string } | null;
      output?: { path?: string; format?: string; source?: string } | null;
    };
    assets?: Array<{ name?: string; path?: string; type?: string }>;
    integrity?: { algorithm?: string; verified?: boolean };
  };
}

const initialLogs = [
  "[system] 生产运行网关已就绪",
  "[provider] 只接受不可变 OCI 镜像与真实 Argo Workflow",
  "[scene] 等待选择运行场景",
];

const containerPhaseLabel: Record<string, string> = {
  queued: "等待",
  pulling: "装载适配器",
  starting: "启动中",
  running: "运行中",
  canceling: "正在停止",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  canceled: "已终止",
};

const getContainerPhase = (
  simulationStatus: SimulationStatus,
  progress: number,
  index: number,
) => {
  if (simulationStatus === "failed") return "failed";
  if (simulationStatus === "canceling") return "canceling";
  if (simulationStatus === "completed") return "completed";
  if (simulationStatus === "paused") return "paused";
  if (simulationStatus === "idle" || simulationStatus === "validating") return "queued";
  const offset = index * 3;
  if (progress < 10 + offset) return "pulling";
  if (progress < 24 + offset) return "starting";
  return "running";
};

const readableWorkflowName = (run: SimulationRun) => {
  const name = String(run.workflow_name || "").trim();
  const replacementCount = (name.match(/[?\uFFFD]/g) || []).length;
  const isReadable = name.length > 0 && replacementCount / name.length < 0.35;
  return isReadable
    ? name
    : run.remote_workflow?.name || run.id;
};

export default function SimulationLab() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [algorithms, setAlgorithms] = useState<SimulationAlgorithm[]>([]);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [selectedAlgorithmIds, setSelectedAlgorithmIds] = useState<Array<string | number>>([]);
  const [selectedRobotId, setSelectedRobotId] = useState<string>("");
  const [selectedScene, setSelectedScene] = useState("warehouse");
  const [faultMode, setFaultMode] = useState<
    "none" | "sensor-dropout" | "algorithm-timeout"
  >("none");
  const [seed, setSeed] = useState(20260724);
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>(initialLogs);
  const [runId, setRunId] = useState<string | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<SimulationRun | null>(null);
  const [compatibility, setCompatibility] = useState<CompatibilityReport | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetFilter, setAssetFilter] = useState<"all" | "retail" | "actual">("actual");
  const [startError, setStartError] = useState<string | null>(null);
  const [downloadingEvidence, setDownloadingEvidence] = useState(false);
  const [runHistory, setRunHistory] = useState<SimulationRun[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [visualEvidenceImages, setVisualEvidenceImages] = useState<{
    input?: string;
    output?: string;
    error?: string;
    loading?: boolean;
  }>({});
  const visualEvidenceObjectUrls = useRef<string[]>([]);
  const [visualEvidenceReload, setVisualEvidenceReload] = useState(0);

  const workflow = useMemo<SimulationWorkflow>(() => {
    const stateWorkflow = (location.state as { simulationData?: SimulationWorkflow } | null)?.simulationData;
    if (stateWorkflow) return stateWorkflow;
    try {
      return JSON.parse(sessionStorage.getItem("simulationWorkflow") || "{}");
    } catch {
      return {};
    }
  }, [location.state]);

  useEffect(() => {
    const loadAssets = async () => {
      try {
        const [algorithmResponse, robotResponse, scenarioResponse] = await Promise.all([
          simulationAlgorithmApi.getList(),
          resourceApi.getRobots(),
          simulationApi.getScenarios(),
        ]);
        const loadedAlgorithms = algorithmResponse.result?.data || [];
        setAlgorithms(loadedAlgorithms);
        setRobots(robotResponse || []);
        setScenarios(scenarioResponse.result?.data || []);

        const matchedIds = (workflow.algorithms || [])
          .map((incoming) => {
            const assetId = typeof incoming === "string" ? null : incoming.assetId;
            const name = typeof incoming === "string" ? incoming : incoming.name;
            return loadedAlgorithms.find((algorithm: SimulationAlgorithm) =>
              assetId !== null && assetId !== undefined
                ? String(algorithm.id) === String(assetId)
                : algorithm.name === name,
            )?.id;
          })
          .filter((id): id is string | number => id !== undefined);
        setSelectedAlgorithmIds(matchedIds);

        const importsRetailTask = loadedAlgorithms.some(
          (algorithm: SimulationAlgorithm) =>
            matchedIds.some((id) => String(id) === String(algorithm.id)) &&
            (algorithm.module.includes("便利店") ||
              algorithm.name.includes("便利店") ||
              algorithm.name.includes("条码") ||
              String(algorithm.catalog_key || "").includes("retail")),
        );
        if (importsRetailTask) setSelectedScene("retail-store");

        const incomingRobot = workflow.robots?.[0];
        const matchedRobot = (robotResponse || []).find(
          (robot: Robot) =>
            String(robot.id) === String(incomingRobot?.id || "") ||
            robot.name === incomingRobot?.name,
        );
        setSelectedRobotId(String(matchedRobot?.id || robotResponse?.[0]?.id || ""));
        const importsManipulatorTask = loadedAlgorithms.some(
          (algorithm: SimulationAlgorithm) =>
            matchedIds.some((id) => String(id) === String(algorithm.id)) &&
            (algorithm.catalog_key === "bullet-panda-pick-place" ||
              algorithm.module.includes("机械臂") ||
              algorithm.module.includes("操作")),
        );
        if (matchedRobot?.model?.toUpperCase().includes("ARM") || importsManipulatorTask) {
          setSelectedScene("manipulation-cell");
        }

        if (matchedIds.length > 0) {
          setLogs((prev) => [
            ...prev,
            `[workflow] 已从“${workflow.name || "工作流"}”导入 ${matchedIds.length} 个算法容器`,
          ]);
        }
      } catch (error) {
        console.error("Load simulation assets failed:", error);
        toast({
          title: "加载失败",
          description: "无法读取仿真算法库",
          variant: "destructive",
        });
      }
    };
    loadAssets();
  }, [workflow, toast]);

  const selectedAlgorithms = useMemo(
    () => selectedAlgorithmIds
      .map((id) => algorithms.find((algorithm) => String(algorithm.id) === String(id)))
      .filter(Boolean) as SimulationAlgorithm[],
    [algorithms, selectedAlgorithmIds],
  );
  const hasQualificationAsset = selectedAlgorithms.some((algorithm) => algorithm.status === "quarantined");

  const selectedRobot = useMemo(
    () => robots.find((robot) => String(robot.id) === selectedRobotId),
    [robots, selectedRobotId],
  );
  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScene),
    [scenarios, selectedScene],
  );

  useEffect(() => {
    const savedRunId = sessionStorage.getItem("activeSimulationRunId");
    if (savedRunId) setRunId(savedRunId);
  }, []);

  useEffect(() => {
    if (!runId) return;
    let disposed = false;

    const syncRun = async () => {
      try {
        const response = await simulationApi.getRun(runId);
        if (disposed) return;
        const run = response.result as SimulationRun;
        const terminal = ["completed", "failed", "canceled", "interrupted"].includes(
          run.status,
        );
        setRunSnapshot(run);
        setProgress(run.progress);
        setStatus(run.status);
        if (run.robot?.id) setSelectedRobotId(String(run.robot.id));
        if (run.algorithms?.length) {
          setSelectedAlgorithmIds(run.algorithms.map((algorithm) => algorithm.id));
        }
        if (run.scene) setSelectedScene(run.scene);
        if (run.scenario?.seed !== undefined) setSeed(run.scenario.seed);
        if (
          run.scenario?.fault_mode === "none" ||
          run.scenario?.fault_mode === "sensor-dropout" ||
          run.scenario?.fault_mode === "algorithm-timeout"
        ) {
          setFaultMode(run.scenario.fault_mode);
        }
        const eventLogs = (run.events || []).map((event) => `[${event.type}] ${event.message}`);
        setLogs((current) => [
          ...current,
          ...eventLogs.filter((line) => !current.includes(line)),
        ]);
        if (terminal) {
          sessionStorage.removeItem("activeSimulationRunId");
          window.clearInterval(timer);
        }
      } catch (error) {
        console.error("Sync simulation run failed:", error);
      }
    };

    const timer = window.setInterval(syncRun, 650);
    syncRun();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [runId]);

  const loadRunHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const response = await simulationApi.getRuns(20);
      setRunHistory((response.result?.data || []) as SimulationRun[]);
    } catch (error) {
      console.error("Load production run history failed:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRunHistory();
  }, [loadRunHistory]);

  useEffect(() => {
    if (["completed", "failed", "canceled", "interrupted"].includes(status)) {
      void loadRunHistory();
    }
  }, [loadRunHistory, status]);

  useEffect(() => {
    const evidenceKind = runSnapshot?.evidence?.kind;
    const isVisualEvidence = evidenceKind === "image-edge-detection" || evidenceKind === "barcode-recognition" || evidenceKind === "ocr-recognition" || evidenceKind === "image-classification";
    if (!isVisualEvidence || !runSnapshot?.id) {
      setVisualEvidenceImages({});
      return undefined;
    }

    const abortController = new AbortController();
    setVisualEvidenceImages({ loading: true });
    const hasInput = Boolean(runSnapshot.evidence?.visual_assets?.input?.path) || evidenceKind === "image-edge-detection" || evidenceKind === "barcode-recognition";
    const hasOutput = Boolean(runSnapshot.evidence?.visual_assets?.output?.path) || evidenceKind === "image-edge-detection";
    const loadImage = async (slot: "input" | "output") => {
      const endpoint = evidenceKind === "image-edge-detection" ? `edge-${slot}` : `visual-${slot}`;
      const response = await fetch(buildApiUrl(`/simulation/runs/${encodeURIComponent(runSnapshot.id)}/${endpoint}`), {
        headers: getAuthHeaders(),
        signal: abortController.signal,
      });
      if (!response.ok) throw new Error(`${slot === "input" ? "输入" : "输出"}证据图片返回 ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      return url;
    };

    void Promise.all([
      hasInput ? loadImage("input") : Promise.resolve(undefined),
      hasOutput ? loadImage("output") : Promise.resolve(undefined),
    ]).then(([input, output]) => {
      const nextUrls = [input, output].filter((url): url is string => Boolean(url));
      if (abortController.signal.aborted) {
        nextUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      visualEvidenceObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      visualEvidenceObjectUrls.current = nextUrls;
      setVisualEvidenceImages({ input, output, loading: false });
    }).catch((error) => {
      if (abortController.signal.aborted) return;
      console.error("加载二维视觉运行证据图片失败", error);
      setVisualEvidenceImages({ error: error instanceof Error ? error.message : "未知错误", loading: false });
    });

    return () => {
      abortController.abort();
    };
  }, [visualEvidenceReload, runSnapshot?.evidence?.kind, runSnapshot?.evidence?.visual_assets, runSnapshot?.id]);

  useEffect(() => () => {
    visualEvidenceObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    visualEvidenceObjectUrls.current = [];
  }, []);

  const compositionLocked = ["validating", "running", "canceling", "paused"].includes(status);
  const isProductionAsset = (algorithm: SimulationAlgorithm) =>
    algorithm.execution_adapter === "cube-studio-argo-workflow" &&
    algorithm.image_status !== "build-required" &&
    algorithm.image.includes("@sha256:") &&
    Boolean(algorithm.workflow_manifest);
  const usesRealPipeline = Boolean(
    workflow.pipelineId &&
    selectedAlgorithms.length > 0 &&
    selectedAlgorithms.every(isProductionAsset),
  );
  const workflowBoundAlgorithmIds = useMemo(() =>
    (workflow.algorithms || [])
      .map((incoming) => {
        const assetId = typeof incoming === "string" ? null : incoming.assetId;
        const name = typeof incoming === "string" ? incoming : incoming.name;
        return algorithms.find((algorithm) =>
          assetId !== null && assetId !== undefined
            ? String(algorithm.id) === String(assetId)
            : algorithm.name === name,
        )?.id;
      })
      .filter((id): id is string | number => id !== undefined),
  [algorithms, workflow.algorithms]);
  const filteredAlgorithms = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    return algorithms.filter((algorithm) => {
      const matchesQuery = !query || [
        algorithm.name,
        algorithm.module,
        algorithm.runtime,
        algorithm.image,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesFilter = assetFilter === "all"
        || (assetFilter === "retail" && (
          algorithm.module.includes("便利店") ||
          algorithm.name.includes("便利店") ||
          algorithm.name.includes("条码") ||
          String(algorithm.catalog_key || "").includes("retail")
        ))
        || (assetFilter === "actual" && algorithm.execution_adapter === "cube-studio-argo-workflow");
      return matchesQuery && matchesFilter;
    });
  }, [algorithms, assetFilter, assetQuery]);
  const isActualRun =
    runSnapshot?.execution_mode === "cube-studio-argo" ||
    compatibility?.execution_mode === "cube-studio-argo" ||
    usesRealPipeline;

  const clearFinishedRun = () => {
    setCompatibility(null);
    setStartError(null);
    if (["completed", "failed", "canceled", "interrupted"].includes(status)) {
      sessionStorage.removeItem("activeSimulationRunId");
      setStatus("idle");
      setProgress(0);
      setRunId(null);
      setRunSnapshot(null);
      setLogs(initialLogs);
    }
  };

  const addAlgorithm = (id: string | number) => {
    if (compositionLocked) return;
    const algorithm = algorithms.find((item) => String(item.id) === String(id));
    if (!algorithm || !isProductionAsset(algorithm)) {
      toast({
        title: "资产尚不可运行",
        description: "该源码案例尚未形成带摘要的 OCI 镜像和受控 Argo Workflow，请先在镜像与 Pipeline 页面完成构建。",
        variant: "destructive",
      });
      return;
    }
    if (
      workflow.pipelineId &&
      !workflowBoundAlgorithmIds.some((boundId) => String(boundId) === String(id))
    ) {
      toast({
        title: "算法不属于当前 Pipeline",
        description: "请回到工作流画布修改 Pipeline 绑定，实验室不会在运行前临时替换生产算法。",
        variant: "destructive",
      });
      return;
    }
    clearFinishedRun();
    setSelectedAlgorithmIds((prev) => {
      if (prev.some((item) => String(item) === String(id))) return prev;
      return [...prev, id];
    });
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (compositionLocked) return;
    const id = event.dataTransfer.getData("simulation-algorithm-id");
    if (!id) return;
    const algorithm = algorithms.find((item) => String(item.id) === id);
    if (!algorithm) return;
    addAlgorithm(algorithm.id);
    setLogs((prev) => [...prev, `[compose] 容器 ${algorithm.image} 已加入仿真链`]);
  };

  const removeAlgorithm = (id: string | number) => {
    if (compositionLocked) return;
    clearFinishedRun();
    setSelectedAlgorithmIds((prev) => prev.filter((item) => String(item) !== String(id)));
  };

  const applyRetailTemplate = () => {
    if (compositionLocked) return;
    clearFinishedRun();
    const templateIds = algorithms
      .filter((algorithm) =>
        isProductionAsset(algorithm) &&
        workflowBoundAlgorithmIds.some((id) => String(id) === String(algorithm.id)) &&
        (
          algorithm.name.includes("条码") ||
          algorithm.name.includes("便利店") ||
          String(algorithm.catalog_key || "").includes("barcode") ||
          String(algorithm.catalog_key || "").includes("retail-digital-twin")
        ),
      )
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((algorithm) => algorithm.id);
    setSelectedAlgorithmIds(templateIds);
    setSelectedScene("retail-store");
    setFaultMode("none");
    setLogs((previous) => [
      ...previous,
      `[template] 已装载当前 Pipeline 绑定的便利店真实算法资产`,
    ]);
  };

  const canApplyRetailTemplate = Boolean(
    workflow.pipelineId && algorithms.some((algorithm) =>
      workflowBoundAlgorithmIds.some((id) => String(id) === String(algorithm.id)) &&
      (algorithm.name.includes("条码") ||
        algorithm.name.includes("便利店") ||
        String(algorithm.catalog_key || "").includes("barcode") ||
        String(algorithm.catalog_key || "").includes("retail-digital-twin")),
    ),
  );

  const validateConfiguration = async () => {
    if (!usesRealPipeline || !selectedRobot) return;
    try {
      setStartError(null);
      setStatus("validating");
      const response = await simulationApi.preflight({
        algorithms: selectedAlgorithms,
        scene: selectedScene,
        robot: selectedRobot,
        pipeline_id: workflow.pipelineId,
      });
      const report = response.result as CompatibilityReport;
      setCompatibility(report);
      setStatus(report.runnable ? "idle" : "failed");
      toast({
        title: report.runnable
          ? report.qualification_only ? "隔离验收可提交" : "运行前检查通过"
          : "运行前检查未通过",
        description: report.runnable
          ? report.qualification_only
            ? `兼容性评分 ${report.score}，只允许运行资格验收；验收完成不代表算法可上线`
            : `兼容性评分 ${report.score}，镜像摘要、接口与场景均可提交`
          : report.errors[0] || "存在阻断问题",
        variant: report.runnable ? "default" : "destructive",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStartError(message);
      setStatus("failed");
      toast({ title: "运行前检查失败", description: message, variant: "destructive" });
    }
  };

  const startSimulation = async () => {
    if (!selectedRobot || selectedAlgorithms.length === 0) {
      toast({
        title: "无法启动",
        description: "请选择机器人，并至少拖入一个算法容器",
        variant: "destructive",
      });
      return;
    }
    if (!workflow.pipelineId || !selectedAlgorithms.every(isProductionAsset)) {
      toast({
        title: "不能提交生产运行",
        description: "请从工作流画布进入，并只选择已绑定真实 Pipeline 的不可变镜像资产。",
        variant: "destructive",
      });
      return;
    }

    try {
      setStartError(null);
      setStatus("validating");
      setLogs((prev) => [
        ...prev,
        `[preflight] 正在校验 ${selectedAlgorithms.length} 个算法的镜像规格与 ROS 接口`,
      ]);
      const preflightResponse = await simulationApi.preflight({
        algorithms: selectedAlgorithms,
        scene: selectedScene,
        robot: selectedRobot,
        pipeline_id: workflow.pipelineId,
      });
      const report = preflightResponse.result as CompatibilityReport;
      setCompatibility(report);
      if (!report.runnable) {
        setStatus("failed");
        setLogs((prev) => [
          ...prev,
          ...report.errors.map((message) => `[error] ${message}`),
        ]);
        toast({
          title: "接口预检失败",
          description: report.errors[0] || "算法规格不完整",
          variant: "destructive",
        });
        return;
      }

      const response = await simulationApi.run({
        workflow_name: workflow.name || "仿真实验室工作流",
        pipeline_id: workflow.pipelineId,
        robot: selectedRobot,
        algorithms: selectedAlgorithms,
        scene: selectedScene,
        seed,
        fault_mode: faultMode,
      });
      setRunId(response.result.id);
      setRunSnapshot(response.result as SimulationRun);
      sessionStorage.setItem("activeSimulationRunId", response.result.id);
      setProgress(response.result.progress || 0);
      setStatus(response.result.status);
      setLogs([
        `[preflight] 接口预检通过，${report.warnings.length} 条部署提示`,
        `[run] 已提交真实 Cube Studio / Argo Workflow ${response.result.remote_workflow?.name}`,
        `[robot] 加载机器人 ${selectedRobot.name} (${selectedRobot.model})`,
        `[manifest] seed=${seed} · fault=${faultMode} · sha256=${String(response.result.run_manifest?.sha256 || "").slice(0, 12)}`,
        ...selectedAlgorithms.map((algorithm) => `[container] 提交不可变镜像 ${algorithm.image}`),
        "[evidence] 等待容器断言、SHA-256 校验与 MinIO 归档证据",
      ]);
      toast({
        title: "真实 Pipeline 已提交",
        description: `Argo Workflow ${response.result.remote_workflow?.name} 正在运行`,
      });
    } catch (error) {
      console.error("Start simulation failed:", error);
      setStatus("failed");
      setProgress(0);
      setRunId(null);
      setRunSnapshot(null);
      sessionStorage.removeItem("activeSimulationRunId");
      const message = error instanceof Error ? error.message : "仿真运行接口返回错误";
      setStartError(message);
      toast({
        title: "启动失败",
        description: message,
        variant: "destructive",
      });
    }
  };

  const cancelSimulation = async () => {
    if (!runId || !runSnapshot) return;
    try {
      const response = await simulationApi.controlRun(
        runId,
        "cancel",
        runSnapshot.revision,
      );
      setRunSnapshot(response.result as SimulationRun);
      setStatus(response.result.status);
      setProgress(response.result.progress);
      toast({ title: "Workflow 已终止", description: "Kubernetes 已级联停止容器节点，本次运行不会生成可发布证据" });
    } catch (error) {
      toast({ title: "停止失败", description: String(error), variant: "destructive" });
    }
  };

  const resetSimulation = () => {
    if (["running", "canceling", "validating"].includes(status)) return;
    sessionStorage.removeItem("activeSimulationRunId");
    setStatus("idle");
    setProgress(0);
    setRunId(null);
    setRunSnapshot(null);
    setCompatibility(null);
    setStartError(null);
    setLogs(initialLogs);
  };

  const restoreRun = async (historyRun: SimulationRun) => {
    try {
      const response = await simulationApi.getRun(historyRun.id);
      const run = response.result as SimulationRun;
      setRunId(run.id);
      setRunSnapshot(run);
      setStatus(run.status);
      setProgress(run.progress);
      setCompatibility(null);
      setStartError(null);
      if (run.robot?.id) setSelectedRobotId(String(run.robot.id));
      if (run.algorithms?.length) setSelectedAlgorithmIds(run.algorithms.map((algorithm) => algorithm.id));
      if (run.scene) setSelectedScene(run.scene);
      setLogs((run.events || []).map((event) => `[${event.type}] ${event.message}`));
      setHistoryOpen(false);
    } catch (error) {
      toast({
        title: "运行记录加载失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const downloadEvidence = async () => {
    if (!runSnapshot?.artifact_id) return;
    const filename = runSnapshot.evidence?.artifact_key?.split("/").pop() || `${runSnapshot.id}-evidence.tgz`;
    try {
      setDownloadingEvidence(true);
      await platformApi.downloadArtifact(runSnapshot.artifact_id, filename);
      toast({ title: "证据包已下载", description: filename });
    } catch (error) {
      toast({
        title: "下载失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setDownloadingEvidence(false);
    }
  };

  const isPhysicsEvidence = runSnapshot?.evidence?.kind === "physics-simulation";
  const isRetailEvidence = runSnapshot?.evidence?.kind === "retail-digital-twin";
  const isImageEdgeEvidence = runSnapshot?.evidence?.kind === "image-edge-detection";
  const isBarcodeEvidence = runSnapshot?.evidence?.kind === "barcode-recognition";
  const isMappingQualificationEvidence = runSnapshot?.evidence?.kind === "mapping-runtime-qualification";
  const visualEvidenceKinds = new Set(["image-edge-detection", "barcode-recognition", "ocr-recognition", "image-classification"]);
  const threeDimensionalEvidenceKinds = new Set(["physics-simulation", "retail-digital-twin"]);
  const isTwoDimensionalVisualAlgorithm = (algorithm: SimulationAlgorithm) => {
    if (algorithm.evidence_kind === "mapping-runtime-qualification") return false;
    if (algorithm.evidence_kind && visualEvidenceKinds.has(algorithm.evidence_kind)) return true;
    if (algorithm.evidence_kind && threeDimensionalEvidenceKinds.has(algorithm.evidence_kind)) return false;
    const descriptor = [algorithm.name, algorithm.module, algorithm.catalog_key, ...algorithm.inputs, ...algorithm.outputs].join(" ");
    if (/导航|避障|SLAM|建图|点云|mesh|数字孪生|物理|机械臂|抓取|moveit|运动规划/i.test(descriptor)) return false;
    return /边缘|OCR|分类|条码|图像识别|image|camera|vision|detect|class/i.test(descriptor);
  };
  const isThreeDimensionalAlgorithm = (algorithm: SimulationAlgorithm) => {
    if (algorithm.evidence_kind === "mapping-runtime-qualification") return false;
    if (algorithm.evidence_kind && threeDimensionalEvidenceKinds.has(algorithm.evidence_kind)) return true;
    const descriptor = [algorithm.name, algorithm.module, algorithm.catalog_key, ...algorithm.inputs, ...algorithm.outputs].join(" ");
    return /导航|避障|SLAM|建图|点云|mesh|数字孪生|物理|机械臂|抓取|moveit|运动规划/i.test(descriptor);
  };
  const selectedVisualAlgorithm = selectedAlgorithms.find(isTwoDimensionalVisualAlgorithm);
  const selectedThreeDimensionalAlgorithm = selectedAlgorithms.find(isThreeDimensionalAlgorithm);
  const selectedMappingQualificationAlgorithm = selectedAlgorithms.find(
    (algorithm) => algorithm.evidence_kind === "mapping-runtime-qualification",
  );
  const isMappingQualificationTask = isMappingQualificationEvidence || Boolean(selectedMappingQualificationAlgorithm);
  const isImageEdgeTask = isImageEdgeEvidence || selectedVisualAlgorithm?.evidence_kind === "image-edge-detection" || /边缘|edge/i.test(selectedVisualAlgorithm?.name || "");
  const showVisualEvidenceViewport = isImageEdgeEvidence || isBarcodeEvidence || Boolean(selectedVisualAlgorithm);
  const showMappingQualificationViewport = isMappingQualificationEvidence || Boolean(selectedMappingQualificationAlgorithm);
  const showThreeDimensionalViewport =
    !showMappingQualificationViewport &&
    (isPhysicsEvidence || isRetailEvidence || (!showVisualEvidenceViewport && Boolean(selectedThreeDimensionalAlgorithm)));
  const workflowStep = status === "completed"
    ? 4
    : status === "running" || status === "canceling" || status === "paused" || status === "validating" || compatibility?.runnable
      ? 3
      : selectedAlgorithms.length > 0 && selectedRobot
        ? 2
        : 1;
  const workflowSteps = [
    { id: 1, label: "选择算法", hint: `${selectedAlgorithms.length} 个资产` },
    { id: 2, label: "配置环境", hint: selectedScenario?.label || "待配置" },
    { id: 3, label: "预检与执行", hint: isActualRun ? "Cube Studio" : "等待真实 Pipeline" },
    { id: 4, label: "结果与证据", hint: status === "completed" ? "可查看" : "等待运行" },
  ];

  return (
    <div className="min-w-0 space-y-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <MonitorPlay className="h-4 w-4" />
            Docker / ROS 生产算法编排
          </div>
          <h1 className="text-3xl font-bold">算法运行与仿真实验室</h1>
          <p className="mt-2 text-muted-foreground">
            从不可变算法资产到可校验证据的一站式工作台，只提交真实 Cube Studio Pipeline。
          </p>
          <div className={`mt-3 flex max-w-3xl items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            isActualRun && !hasQualificationAsset
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/25 bg-amber-500/10 text-amber-300"
          }`}>
            {isActualRun && !hasQualificationAsset ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {isActualRun
              ? hasQualificationAsset
                ? "当前任务只会提交隔离资格验收 Workflow；在容器断言全部通过前，不会将该镜像标记为可上线算法。"
                : "当前任务将提交真实 Cube Studio / Argo Workflow，并以容器断言和 MinIO 产物作为闭环证据。"
              : "尚未形成可运行链：请从工作流画布选择真实 Pipeline、机器人和已构建算法资产。"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setHistoryOpen(true);
              void loadRunHistory();
            }}
          >
            <History className="mr-2 h-4 w-4" />运行记录
          </Button>
          <Button
            variant="outline"
            onClick={validateConfiguration}
            disabled={!usesRealPipeline || ["validating", "running", "canceling"].includes(status)}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />运行前检查
          </Button>
          {(status === "running" || status === "canceling") && isActualRun ? (
            <Button disabled>
              <Activity className="mr-2 h-4 w-4 animate-pulse" />
              {status === "canceling" ? "正在停止真实任务" : "真实任务运行中"}
            </Button>
          ) : (
            <Button
              onClick={startSimulation}
              disabled={!usesRealPipeline || status === "validating"}
            >
              <Play className="mr-2 h-4 w-4" />
              {status === "validating" ? "正在预检" : hasQualificationAsset ? "运行隔离验收" : "运行真实 Pipeline"}
            </Button>
          )}
          {status === "running" && isActualRun && (
            <Button
              variant="destructive"
              onClick={cancelSimulation}
            >
              <StopCircle className="mr-2 h-4 w-4" />停止 Workflow
            </Button>
          )}
          <Button
            variant="outline"
            onClick={resetSimulation}
            disabled={["running", "canceling", "validating"].includes(status)}
          >
            <RotateCcw className="mr-2 h-4 w-4" />重置
          </Button>
          {workflow.monitoringData && (
            <Button
              variant="secondary"
              onClick={() => navigate("/monitoring", {
                state: { monitoringData: workflow.monitoringData },
              })}
            >
              <Activity className="mr-2 h-4 w-4" />实时监控
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden border-border/80 bg-card/70">
        <CardContent className="p-0">
          <div className="grid divide-y md:grid-cols-4 md:divide-x md:divide-y-0">
            {workflowSteps.map((step) => {
              const complete = workflowStep > step.id || status === "completed";
              const active = workflowStep === step.id && status !== "completed";
              return (
                <div key={step.id} className={`flex items-center gap-3 px-4 py-3 ${active ? "bg-primary/8" : ""}`}>
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                    complete
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                      : active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground"
                  }`}>
                    {complete ? <CheckCircle2 className="h-4 w-4" /> : step.id}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{step.hint}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_330px]">
        <Card className="overflow-hidden lg:sticky lg:top-4 lg:h-[780px]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Container className="h-4 w-4" />
                算法组件库
              </CardTitle>
              <Badge variant="secondary">{filteredAlgorithms.length}/{algorithms.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">只有已构建、摘要锁定并绑定 Argo Workflow 的资产可加入运行链</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={assetQuery}
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder="搜索名称、模块或镜像"
                className="pl-9"
                aria-label="搜索算法组件"
              />
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1">
              {([
                ["actual", "可提交"],
                ["retail", "便利店"],
                ["all", "全部"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={assetFilter === value ? "secondary" : "ghost"}
                  className="h-7 px-1 text-[11px]"
                  onClick={() => setAssetFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start gap-3 border-dashed px-3 py-2.5 text-left"
              disabled={compositionLocked || !canApplyRetailTemplate}
              onClick={applyRetailTemplate}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-400">
                <Store className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">装载当前便利店 Pipeline</span>
                <span className="block truncate text-[10px] text-muted-foreground">点云/识别/导航/抓取基线 → MinIO 证据</span>
              </span>
            </Button>
            <ScrollArea className="h-[500px] pr-3 xl:h-[555px]">
              <div className="space-y-2">
                {filteredAlgorithms.map((algorithm) => {
                  const isSelected = selectedAlgorithmIds.some(
                    (id) => String(id) === String(algorithm.id),
                  );
                  const canRun = isProductionAsset(algorithm);
                  const isBoundToWorkflow = !workflow.pipelineId || workflowBoundAlgorithmIds.some(
                    (id) => String(id) === String(algorithm.id),
                  );
                  const canAdd = canRun && isBoundToWorkflow;
                  return (
                    <div
                      key={algorithm.id}
                      draggable={!compositionLocked && canAdd}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("simulation-algorithm-id", String(algorithm.id));
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                       onDoubleClick={() => addAlgorithm(algorithm.id)}
                       onClick={() => addAlgorithm(algorithm.id)}
                       className={`rounded-lg border p-2.5 transition ${canAdd ? "cursor-pointer" : "cursor-not-allowed opacity-70"} ${
                         isSelected ? "border-primary/50 bg-primary/10" : "hover:border-primary/40 hover:bg-accent"
                       }`}
                      aria-disabled={compositionLocked || !canAdd}
                    >
                      <div className="flex items-start gap-2.5">
                        <GripVertical className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold">{algorithm.name}</span>
                            <span
                              className={`h-2 w-2 rounded-full ${
                                algorithm.status === "quarantined"
                                  ? "bg-amber-400"
                                  : algorithm.status === "verified-source"
                                  ? "bg-amber-400"
                                  : "bg-emerald-400"
                              }`}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{algorithm.module}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                              {canRun
                                ? algorithm.status === "quarantined" ? "隔离验收" : "真实 Pipeline"
                                : algorithm.status === "verified-source"
                                  ? "源码已验证 · 待构建"
                                  : "本地镜像"}
                            </Badge>
                            {algorithm.license && (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
                                {algorithm.license}
                              </Badge>
                            )}
                            {algorithm.repository_url && /^https?:\/\//i.test(algorithm.repository_url) && (
                              <a
                                href={algorithm.repository_url}
                                target="_blank"
                                rel="noreferrer"
                                draggable={false}
                                onClick={(event) => event.stopPropagation()}
                                className="ml-auto text-primary hover:text-primary/80"
                                aria-label={`打开 ${algorithm.name} GitHub 仓库`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? "secondary" : "outline"}
                              className="ml-auto h-7 px-2 text-[10px]"
                              disabled={compositionLocked || isSelected || !canAdd}
                              onClick={(event) => {
                                event.stopPropagation();
                                addAlgorithm(algorithm.id);
                              }}
                            >
                              {isSelected
                                ? "已加入"
                                : canAdd
                                  ? algorithm.status === "quarantined" ? "加入验收链" : "加入运行链"
                                  : canRun ? "未绑定" : "待构建"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredAlgorithms.length === 0 && (
                  <div className="grid min-h-44 place-items-center rounded-lg border border-dashed text-center">
                    <div>
                      <PackageSearch className="mx-auto h-7 w-7 text-muted-foreground" />
                      <p className="mt-2 text-sm">没有匹配的算法</p>
                      <button className="mt-1 text-xs text-primary" onClick={() => { setAssetQuery(""); setAssetFilter("all"); }}>
                        清除筛选
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Workflow className="h-4 w-4" />
                  运行链与环境
                </CardTitle>
                <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
                  <div className="w-full sm:w-52">
                    <Select
                      value={selectedScene}
                      onValueChange={(value) => {
                        clearFinishedRun();
                        setSelectedScene(value);
                      }}
                      disabled={compositionLocked}
                    >
                      <SelectTrigger aria-label="选择运行场景">
                        <SelectValue placeholder="选择场景" />
                      </SelectTrigger>
                      <SelectContent>
                        {scenarios.map((scenario) => (
                          <SelectItem key={scenario.id} value={scenario.id}>
                            {scenario.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full sm:w-52">
                  <Select
                    value={selectedRobotId}
                    onValueChange={(id) => {
                      clearFinishedRun();
                      setSelectedRobotId(id);
                      const robot = robots.find((item) => String(item.id) === id);
                      if (robot?.model?.toUpperCase().includes("ARM")) {
                        setSelectedScene("manipulation-cell");
                      }
                    }}
                    disabled={compositionLocked}
                  >
                    <SelectTrigger><SelectValue placeholder="选择机器人" /></SelectTrigger>
                    <SelectContent>
                      {robots.map((robot) => (
                        <SelectItem key={robot.id} value={String(robot.id)}>
                          {robot.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                  <div className="w-full sm:w-52">
                    <Select
                      value={faultMode}
                      onValueChange={(value) => {
                        clearFinishedRun();
                        setFaultMode(value as typeof faultMode);
                      }}
                      disabled
                    >
                      <SelectTrigger aria-label="故障注入策略">
                        <SelectValue placeholder="故障注入策略" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">无故障注入</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs sm:grid-cols-3">
                <div className="min-w-0">
                  <span className="text-muted-foreground">来源工作流</span>
                  <p className="truncate font-medium">{workflow.name || "未关联工作流"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">执行通道</span>
                  <p className={isActualRun ? "font-medium text-emerald-400" : "font-medium text-amber-400"}>
                    {isActualRun ? "真实 Cube Studio" : "未提交"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">接口链</span>
                  <p className="font-medium">{selectedAlgorithms.length ? `${selectedAlgorithms.length} 个节点` : "待选择"}</p>
                </div>
              </div>
              <div
                className="min-h-28 rounded-xl border-2 border-dashed border-border bg-muted/20 p-4"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = compositionLocked ? "none" : "copy";
                }}
                onDrop={handleDrop}
              >
                {selectedAlgorithms.length === 0 ? (
                  <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
                    从组件库单击算法，或拖动到这里组成运行链
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedAlgorithms.map((algorithm, index) => (
                      <div key={algorithm.id} className="flex items-center gap-2">
                        <div className="group relative min-w-40 rounded-lg border bg-card p-3">
                          {(() => {
                            const phase =
                              runSnapshot?.container_states?.find(
                                (state) => String(state.id) === String(algorithm.id),
                              )?.status || getContainerPhase(status, progress, index);
                            return (
                              <div className="mb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    phase === "failed"
                                      ? "bg-red-400"
                                      : phase === "completed"
                                        ? "bg-emerald-400"
                                        : phase === "running"
                                          ? "animate-pulse bg-blue-400"
                                          : "bg-amber-400"
                                  }`}
                                />
                                {containerPhaseLabel[phase]}
                              </div>
                            );
                          })()}
                          <div className="flex items-center gap-2">
                            <Box className="h-4 w-4" style={{ color: algorithm.color }} />
                            <span className="text-sm font-medium">{algorithm.name}</span>
                          </div>
                          <p className="mt-1 max-w-44 truncate font-mono text-[10px] text-muted-foreground">
                            {algorithm.image}
                          </p>
                          <button
                            onClick={() => removeAlgorithm(algorithm.id)}
                            disabled={compositionLocked}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`移除${algorithm.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        {index < selectedAlgorithms.length - 1 && (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MonitorPlay className="h-4 w-4" />
                  {showMappingQualificationViewport
                    ? `${selectedMappingQualificationAlgorithm?.name || runSnapshot?.evidence?.algorithm?.name || "建图交付镜像"} · 运行时验收`
                    : showVisualEvidenceViewport
                    ? `${selectedVisualAlgorithm?.name || runSnapshot?.evidence?.algorithm?.name || "二维视觉算法"} · 证据视图`
                    : showThreeDimensionalViewport
                      ? selectedScenario?.label || "三维运行场景"
                      : "运行证据视图"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {showMappingQualificationViewport
                      ? "架构 · ROS 2 · 依赖 · 数据集"
                      : showVisualEvidenceViewport
                      ? "原始输入 · 算法结果 · 局部放大"
                      : isRetailEvidence
                      ? "点云 Mesh · A* 轨迹证据"
                      : isPhysicsEvidence
                      ? "Bullet 物理轨迹 · WebGL 遥测回放"
                      : showThreeDimensionalViewport
                        ? "三维遥测 · 仅展示真实证据"
                        : "等待可识别的运行证据"}
                  </Badge>
                  <Badge
                    className={
                      status === "completed"
                        ? runSnapshot?.outcome?.publishable === false
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-emerald-500/15 text-emerald-400"
                        : status === "running"
                          ? "bg-blue-500/15 text-blue-400"
                            : status === "failed"
                              ? "bg-red-500/15 text-red-400"
                              : status === "canceled" || status === "interrupted"
                                ? "bg-red-500/15 text-red-400"
                            : status === "validating"
                              ? "bg-amber-500/15 text-amber-400"
                          : "bg-muted text-muted-foreground"
                    }
                  >
                    {status === "completed"
                      ? runSnapshot?.outcome?.publishable === false
                        ? "验收阻断"
                        : "运行完成"
                      : status === "running"
                        ? "运行中"
                        : status === "paused"
                          ? "已暂停"
                          : status === "validating"
                            ? "接口预检"
                            : status === "failed"
                              ? "运行失败"
                              : status === "canceled"
                                ? "已取消"
                                : status === "interrupted"
                                  ? "已中断"
                              : "待启动"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {showMappingQualificationViewport ? (
                <MappingQualificationViewport
                  status={status}
                  algorithmName={selectedMappingQualificationAlgorithm?.name || runSnapshot?.evidence?.algorithm?.name}
                  image={selectedMappingQualificationAlgorithm?.image || runSnapshot?.algorithms?.find((algorithm) => algorithm.evidence_kind === "mapping-runtime-qualification")?.image}
                  evidence={runSnapshot?.evidence}
                />
              ) : showVisualEvidenceViewport ? (
                <VisualEvidenceViewport
                  key={runSnapshot?.id || selectedVisualAlgorithm?.id || "visual-evidence"}
                  status={status}
                  algorithmName={selectedVisualAlgorithm?.name || runSnapshot?.evidence?.algorithm?.name}
                  evidence={runSnapshot?.evidence}
                  inputUrl={visualEvidenceImages.input}
                  outputUrl={visualEvidenceImages.output}
                  loading={visualEvidenceImages.loading}
                  error={visualEvidenceImages.error}
                  onRetry={() => setVisualEvidenceReload((value) => value + 1)}
                />
              ) : showThreeDimensionalViewport ? (
                <Suspense fallback={<div className="grid min-h-[520px] place-items-center text-sm text-muted-foreground">正在加载 WebGL 遥测查看器…</div>}>
                  <PhysicsSimulationViewport
                    sceneId={selectedScene}
                    runId={runSnapshot?.id}
                    status={status}
                    robotModel={selectedRobot?.model}
                    evidence={runSnapshot?.evidence}
                    pose={runSnapshot?.pose}
                  />
                </Suspense>
              ) : (
                <div className="grid min-h-[520px] place-items-center bg-[#07101c] px-6 text-center text-sm text-slate-400">
                  <div className="max-w-lg">
                    <PackageSearch className="mx-auto h-10 w-10 text-slate-500" />
                    <p className="mt-4 font-medium text-slate-200">当前算法尚未声明可用的证据查看器</p>
                    <p className="mt-2 leading-6">平台不会使用货架、机器人动画或伪造指标填充此区域。请在算法描述中声明二维图像证据，或提供三维遥测、点云 Mesh、物理关键帧等真实产物。</p>
                  </div>
                </div>
              )}
              <div className="border-t p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>{isActualRun ? "Cube Studio Workflow 进度" : "尚未提交真实 Pipeline"}</span>
                  <span className="font-mono">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:col-span-2 xl:col-span-1 xl:block xl:space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4" />
                运行指标
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3 text-xs">
                <span className="text-muted-foreground">执行模式</span>
                <Badge variant="outline">
                  {isActualRun ? "Cube Studio / Argo · 真实容器" : "未运行"}
                </Badge>
              </div>
              {isActualRun ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">容器状态</p>
                    <p className={`mt-1 text-lg font-bold ${status === "completed" ? runSnapshot?.outcome?.publishable === false ? "text-amber-400" : "text-emerald-400" : ""}`}>
                      {status === "completed"
                        ? runSnapshot?.outcome?.publishable === false
                          ? "兼容性阻断"
                          : "断言通过"
                        : status === "running" ? "运行中" : "等待执行"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{isMappingQualificationTask ? "容器 / 二进制" : isImageEdgeTask ? "图像尺寸" : isRetailEvidence ? "Mesh 面数" : isPhysicsEvidence ? "目标误差" : "识别数量"}</p>
                    <p className="mt-1 text-lg font-bold">
                      {isMappingQualificationTask
                        ? `${runSnapshot?.evidence?.runtime?.container_arch || "—"} / ${runSnapshot?.evidence?.runtime?.payload_binary_arch || "—"}`
                        : isImageEdgeTask
                        ? runSnapshot?.evidence?.metrics?.width_px && runSnapshot?.evidence?.metrics?.height_px
                          ? `${runSnapshot.evidence.metrics.width_px} × ${runSnapshot.evidence.metrics.height_px}`
                          : "—"
                        : isRetailEvidence
                        ? runSnapshot?.evidence?.scene?.mesh?.faces?.toLocaleString() ?? "—"
                        : isPhysicsEvidence
                        ? runSnapshot?.evidence?.metrics?.final_position_error_m != null
                          ? `${(runSnapshot.evidence.metrics.final_position_error_m * 1000).toFixed(2)} mm`
                          : "—"
                        : runSnapshot?.evidence?.found ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{isMappingQualificationTask ? "上线阻断项" : isImageEdgeTask ? "边缘均值" : isRetailEvidence ? "导航路径" : isPhysicsEvidence ? "实时因子" : "算法耗时"}</p>
                    <p className="mt-1 text-lg font-bold">
                      {isMappingQualificationTask
                        ? `${runSnapshot?.evidence?.blockers?.length || 0} 项`
                        : isImageEdgeTask
                        ? runSnapshot?.evidence?.metrics?.edge_mean != null
                          ? runSnapshot.evidence.metrics.edge_mean.toFixed(4)
                          : "—"
                        : isRetailEvidence
                        ? runSnapshot?.evidence?.navigation?.path_length_m != null
                          ? `${runSnapshot.evidence.navigation.path_length_m.toFixed(3)} m`
                          : "—"
                        : isPhysicsEvidence
                        ? runSnapshot?.evidence?.metrics?.real_time_factor != null
                          ? `${runSnapshot.evidence.metrics.real_time_factor.toFixed(2)}x`
                          : "—"
                        : runSnapshot?.evidence?.elapsed_ms != null
                          ? `${runSnapshot.evidence.elapsed_ms.toFixed(2)} ms`
                          : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">证据归档</p>
                    <p className="mt-1 text-lg font-bold">{runSnapshot?.artifact_id ? "MinIO" : "等待中"}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">运行遥测</p>
                    <p className="mt-1 text-xl font-bold">—</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">接口链状态</p>
                    <p className="mt-1 text-lg font-bold">{compatibility?.runnable ? "可提交" : "待真实资产"}</p>
                  </div>
                  <div className="col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                    页面不会生成合成位置、轨迹或性能指标；提交真实 Pipeline 后才显示容器采集的证据。
                  </div>
                </div>
              )}
              {runSnapshot?.last_sync_error && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>集群状态同步暂时失败，页面会自动重试：{runSnapshot.last_sync_error}</span>
                </div>
              )}
              {runSnapshot?.run_manifest && (
                <div className="rounded-lg border bg-muted/20 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">可复现清单</span>
                    <Badge variant="secondary">seed {runSnapshot.scenario?.seed}</Badge>
                  </div>
                  <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                    SHA-256 {runSnapshot.run_manifest.sha256}
                  </p>
                </div>
              )}
              {compatibility && (
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    compatibility.runnable
                      ? "border-emerald-500/25 bg-emerald-500/10"
                      : "border-red-500/25 bg-red-500/10"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {compatibility.runnable ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                    )}
                    {compatibility.runnable ? "镜像、接口与场景预检通过" : "运行前预检失败"}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    评分 {compatibility.score} · {compatibility.steps.length} 个算法 ·{" "}
                    {compatibility.errors.length} 个阻断错误 · {compatibility.warnings.length} 条提示
                  </p>
                  {compatibility.errors.map((message) => (
                    <p key={message} className="mt-1 text-red-300">• {message}</p>
                  ))}
                  {compatibility.warnings.map((message) => (
                    <p key={message} className="mt-1 text-amber-200">• {message}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="h-[420px] xl:h-[466px]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4" />
                {isActualRun ? "运行事件与容器回传" : "仿真事件日志"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[325px] rounded-lg border bg-slate-950 p-3 xl:h-[370px]">
                <div className="space-y-2 font-mono text-xs text-slate-300">
                  {logs.map((log, index) => (
                    <div key={`${index}-${log}`} className="flex gap-2">
                      <span className="select-none text-slate-600">{String(index + 1).padStart(2, "0")}</span>
                      <span
                        className={
                          log.includes("[result]")
                            ? "text-emerald-400"
                            : log.includes("[qualification_blocked]")
                              ? "text-amber-300"
                            : log.includes("[error]") || log.includes("[assertion_failed]")
                              ? "text-red-400"
                              : log.includes("[preflight]")
                                ? "text-amber-300"
                                : ""
                        }
                      >
                        {log}
                      </span>
                    </div>
                  ))}
                  {(status === "running" || status === "validating") && (
                    <div className="flex items-center gap-2 text-blue-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                      {status === "validating"
                        ? "正在校验镜像、输入输出与场景..."
                        : isActualRun
                          ? "正在同步 Cube Studio Workflow 状态..."
                          : "等待真实 Pipeline 提交..."}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {status === "completed" && (
            <div className={`rounded-xl border p-4 text-sm md:col-span-2 xl:col-span-1 ${
              runSnapshot?.outcome?.publishable === false
                ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                : isActualRun
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-blue-500/30 bg-blue-500/10 text-blue-200"
            }`}>
              <div className="flex items-start gap-3">
                {runSnapshot?.outcome?.publishable === false
                  ? <AlertTriangle className="h-5 w-5 shrink-0" />
                  : <CheckCircle2 className="h-5 w-5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                  {runSnapshot?.outcome?.reason || "真实 Cube Studio 闭环验证通过。"}
                  </p>
                  {runSnapshot?.evidence && (
                    <div className={`mt-3 space-y-2 rounded-lg border bg-background/30 p-3 text-xs ${runSnapshot?.outcome?.publishable === false ? "border-amber-500/20" : "border-emerald-500/20"}`}>
                      {isMappingQualificationEvidence ? (
                        <>
                          <div className="rounded border border-amber-500/25 bg-amber-500/5 p-2 text-amber-100">
                            验收 Pipeline 和证据归档已完成，但原始建图进程没有成功启动；本结果不可作为建图成功证明。
                          </div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">容器 / 二进制架构</span><code>{runSnapshot.evidence.runtime?.container_arch} / {runSnapshot.evidence.runtime?.payload_binary_arch}</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">ROS 2 / 回放数据</span><code>{runSnapshot.evidence.runtime?.ros2_available ? "可用" : "缺失"} / {runSnapshot.evidence.delivery?.dataset_count || 0} 组</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">阻断项 / 完整性</span><code>{runSnapshot.evidence.blockers?.length || 0} / {runSnapshot.evidence.integrity?.verified ? "SHA-256 通过" : "未通过"}</code></div>
                        </>
                      ) : isImageEdgeEvidence ? (
                        <>
                          <div className="rounded border border-emerald-500/25 bg-emerald-500/5 p-2 text-emerald-100">
                            输入图、算法输出、滑动对比与局部放大已在主证据视图中加载；此处仅保留验收摘要，避免重复缩略图误导用户。
                          </div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">图像尺寸</span><code>{runSnapshot.evidence.metrics?.width_px} x {runSnapshot.evidence.metrics?.height_px} px</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">边缘均值 / 半径</span><code>{Number(runSnapshot.evidence.metrics?.edge_mean || 0).toFixed(4)} / {runSnapshot.evidence.metrics?.radius}</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">完整性</span><code>{runSnapshot.evidence.integrity?.verified ? "SHA-256 通过" : "未通过"}</code></div>
                        </>
                      ) : isRetailEvidence ? (
                        <>
                          <div className="flex justify-between gap-3"><span className="opacity-70">点云 / Mesh</span><code>{runSnapshot.evidence.input?.point_count?.toLocaleString()} 点 / {runSnapshot.evidence.scene?.mesh?.faces?.toLocaleString()} 面</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">识别 / 导航</span><code>{runSnapshot.evidence.perception?.detection_count} 个 / {runSnapshot.evidence.navigation?.path_length_m?.toFixed(3)} m</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">传统抓取 / VLA</span><code>{runSnapshot.evidence.manipulation?.reachable ? "IK 可达" : "不可达"} / {runSnapshot.evidence.manipulation?.vla?.status || "未配置"}</code></div>
                          {runSnapshot.evidence.blockers?.map((message) => (
                            <div key={message} className="rounded border border-amber-500/25 bg-amber-500/10 p-2 text-amber-200">能力边界：{message}</div>
                          ))}
                        </>
                      ) : isPhysicsEvidence ? (
                        <>
                          <div className="flex justify-between gap-3"><span className="opacity-70">物理引擎</span><code>{runSnapshot.evidence.engine?.name} {runSnapshot.evidence.engine?.version}</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">搬运距离 / 目标误差</span><code>{runSnapshot.evidence.metrics?.object_transfer_distance_m?.toFixed(3)} m / {((runSnapshot.evidence.metrics?.final_position_error_m || 0) * 1000).toFixed(2)} mm</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">轨迹 / 安全接触</span><code>{runSnapshot.evidence.playback?.keyframe_count} 帧 / {runSnapshot.evidence.metrics?.safety_contact_steps} steps</code></div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between gap-3"><span className="opacity-70">期望条码</span><code>{runSnapshot.evidence.expected_barcode}</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">识别条码</span><code>{runSnapshot.evidence.detected_barcode}</code></div>
                          <div className="flex justify-between gap-3"><span className="opacity-70">格式 / 耗时</span><code>{runSnapshot.evidence.barcode_format} / {runSnapshot.evidence.elapsed_ms?.toFixed(2)} ms</code></div>
                        </>
                      )}
                      <p className="truncate font-mono text-[10px] opacity-60" title={runSnapshot.evidence.artifact_key}>
                        MinIO: {runSnapshot.evidence.artifact_key}
                      </p>
                    </div>
                  )}
                  {runSnapshot?.artifact_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full border-emerald-500/30 bg-background/20"
                      onClick={downloadEvidence}
                      disabled={downloadingEvidence}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {downloadingEvidence ? "正在下载" : "下载完整运行证据包"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          {startError && !runSnapshot && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200 md:col-span-2 xl:col-span-1">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">本次运行没有创建成功</p>
                <p className="mt-1 text-xs opacity-80">{startError}</p>
              </div>
            </div>
          )}
          {status === "failed" && runSnapshot?.outcome && (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {runSnapshot.outcome.reason || "编排安全断言失败。"}
            </div>
          )}
        </div>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />真实运行记录
            </DialogTitle>
            <DialogDescription>
              仅展示 Cube Studio / Argo 的真实运行；打开记录时从 MinIO 恢复遥测和证据。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[62vh] pr-3">
            <div className="space-y-2">
              {runHistory.map((run) => {
                const publishable = run.outcome?.publishable === true;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => void restoreRun(run)}
                    className="w-full rounded-lg border bg-muted/15 p-3 text-left transition hover:border-primary/45 hover:bg-muted/30"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {readableWorkflowName(run)}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                          {run.remote_workflow?.namespace || "pipeline"}/{run.remote_workflow?.name || "—"}
                        </p>
                      </div>
                      <Badge variant={publishable ? "secondary" : "outline"}>
                        {publishable
                          ? "证据通过"
                          : run.outcome?.validation_result === "blocked"
                            ? "验收阻断"
                            : containerPhaseLabel[run.status] || run.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <span>{run.algorithms?.[0]?.name || "未命名算法"}</span>
                      <span>{run.robot?.name || "未绑定机器人"}</span>
                      <span className="sm:text-right">
                        {run.finished_at || run.started_at
                          ? new Intl.DateTimeFormat("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(run.finished_at || run.started_at || ""))
                          : "—"}
                      </span>
                    </div>
                  </button>
                );
              })}
              {!historyLoading && runHistory.length === 0 && (
                <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  暂无真实运行记录
                </div>
              )}
              {historyLoading && runHistory.length === 0 && (
                <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
                  正在读取集群运行记录…
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
