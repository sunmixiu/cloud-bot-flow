import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Container,
  Download,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  deploymentApi,
  edgeApi,
  platformApi,
  simulationApi,
  type EdgeCompatibility,
  type EdgeDeployment,
  type EdgeNode,
} from "@/services/api";

interface AlgorithmAsset {
  id: string | number;
  name: string;
  module: string;
  version: string;
  image: string;
  image_digest?: string;
  runtime: string;
  inputs: string[];
  outputs: string[];
  input_types?: Record<string, string>;
  output_types?: Record<string, string>;
  description: string;
  status: string;
  execution_adapter?: string;
  workflow_bound?: boolean;
  evidence_kind?: string;
  recommended_robot_ids?: Array<string | number>;
}

interface PipelineAsset {
  id: string | number;
  name: string;
  algorithm_ids?: Array<string | number>;
}

interface RobotAsset {
  id: string | number;
  name: string;
  model: string;
}

interface ScenarioAsset {
  id: string;
  label: string;
  version: string;
}

interface CompatibilityReport {
  runnable: boolean;
  publishable_candidate?: boolean;
  score: number;
  scene: string;
  errors: string[];
  warnings: string[];
}

interface DeploymentRun {
  id: string;
  status: string;
  progress: number;
  revision?: number;
  remote_workflow?: {
    name?: string;
    phase?: string;
  };
  outcome?: {
    publishable?: boolean;
    reason?: string;
  };
  evidence?: {
    integrity?: { verified?: boolean };
    blocker_count?: number;
  };
}

interface PlatformReadiness {
  dependencies?: {
    kubernetes?: { reachable?: boolean };
    artifact_store?: { reachable?: boolean };
  };
}

interface DeliveryCatalog {
  algorithms?: AlgorithmAsset[];
  pipelines?: PipelineAsset[];
  robots?: RobotAsset[];
  scenarios?: ScenarioAsset[];
}

type ActionStage = "idle" | "preflight" | "submitting";
type DeploymentTarget = "local" | `edge:${string}`;

const activeRunStatuses = new Set(["starting", "running", "paused", "canceling", "interrupted"]);
const activeEdgeStatuses = new Set(["queued", "pulling", "starting", "running", "stop_requested", "rollback_requested"]);

const statusLabel: Record<string, string> = {
  starting: "正在启动",
  running: "运行中",
  paused: "已暂停",
  canceling: "正在停止",
  canceled: "已停止",
  completed: "运行完成",
  failed: "运行失败",
  interrupted: "等待恢复",
  queued: "等待机器人领取",
  pulling: "正在拉取镜像",
  stop_requested: "等待机器人停止",
  rollback_requested: "等待机器人回滚",
  succeeded: "真机运行成功",
  stopped: "已在机器人停止",
  rolled_back: "已回滚",
};

const resultOf = <T,>(response: unknown): T | null => {
  if (!response || typeof response !== "object") return null;
  return (response as { result?: T }).result ?? null;
};

const isBlackBoxDelivery = (algorithm: AlgorithmAsset) =>
  algorithm.execution_adapter === "cube-studio-argo-workflow" &&
  algorithm.workflow_bound === true &&
  String(algorithm.image || "").includes("@sha256:");

const formatVersion = (version?: string) => {
  if (!version) return "未标注";
  return /^\d/.test(version) ? `v${version}` : version;
};

const shortDigest = (value?: string) => {
  const digest = String(value || "");
  if (!digest) return "未锁定";
  return digest.length > 28 ? `${digest.slice(0, 18)}…${digest.slice(-8)}` : digest;
};

const imageName = (value?: string) => {
  const withoutDigest = String(value || "").split("@sha256:")[0];
  return withoutDigest.split("/").at(-1) || "未命名镜像";
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
};

const preferredScene = (algorithm: AlgorithmAsset) => {
  if (algorithm.evidence_kind === "physics-simulation") return "manipulation-cell";
  if (algorithm.evidence_kind === "mapping-runtime-qualification") return "warehouse";
  return "retail-store";
};

const preferredRobotId = (algorithm: AlgorithmAsset, robots: RobotAsset[]) => {
  const declared = algorithm.recommended_robot_ids?.[0];
  if (declared !== undefined) return String(declared);
  if (algorithm.evidence_kind === "physics-simulation") {
    return String(robots.find((robot) => /ARM/i.test(robot.model))?.id || robots[0]?.id || "");
  }
  if (algorithm.evidence_kind === "retail-digital-twin") {
    return String(robots.find((robot) => /AGV/i.test(robot.model))?.id || robots[0]?.id || "");
  }
  return String(robots[0]?.id || "");
};

const interfaceKind = (algorithm: AlgorithmAsset) => {
  const fields = [...(algorithm.inputs || []), ...(algorithm.outputs || [])];
  return fields.some((field) => field.startsWith("/")) ? "ROS 2 Topic" : "批处理文件合同";
};

export default function QuickDeployment() {
  const [algorithms, setAlgorithms] = useState<AlgorithmAsset[]>([]);
  const [pipelines, setPipelines] = useState<PipelineAsset[]>([]);
  const [robots, setRobots] = useState<RobotAsset[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioAsset[]>([]);
  const [readiness, setReadiness] = useState<PlatformReadiness | null>(null);
  const [edgeNodes, setEdgeNodes] = useState<EdgeNode[]>([]);
  const [deploymentTarget, setDeploymentTarget] = useState<DeploymentTarget>("local");
  const [selectedAlgorithmId, setSelectedAlgorithmId] = useState("");
  const [selectedRobotId, setSelectedRobotId] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("retail-store");
  const [siteCode, setSiteCode] = useState("STORE-SH-001");
  const [report, setReport] = useState<CompatibilityReport | null>(null);
  const [run, setRun] = useState<DeploymentRun | null>(null);
  const [edgeRun, setEdgeRun] = useState<EdgeDeployment | null>(null);
  const [actionStage, setActionStage] = useState<ActionStage>("idle");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "streaming" | "error">("idle");
  const [cameraMessage, setCameraMessage] = useState("");
  const [cameraSequence, setCameraSequence] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraTimerRef = useRef<number | null>(null);
  const cameraUploadingRef = useRef(false);
  const { toast } = useToast();

  const deliverableAlgorithms = useMemo(
    () => algorithms.filter(isBlackBoxDelivery).sort((a, b) => {
      if (a.status === "quarantined" && b.status !== "quarantined") return 1;
      if (a.status !== "quarantined" && b.status === "quarantined") return -1;
      if (Number(a.id) === 121) return -1;
      if (Number(b.id) === 121) return 1;
      return a.name.localeCompare(b.name, "zh-CN");
    }),
    [algorithms],
  );

  const selectedAlgorithm = useMemo(
    () => deliverableAlgorithms.find((algorithm) => String(algorithm.id) === selectedAlgorithmId) || null,
    [deliverableAlgorithms, selectedAlgorithmId],
  );

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) =>
      pipeline.algorithm_ids?.some((id) => String(id) === selectedAlgorithmId),
    ) || null,
    [pipelines, selectedAlgorithmId],
  );

  const selectedRobot = useMemo(
    () => robots.find((robot) => String(robot.id) === selectedRobotId) || null,
    [robots, selectedRobotId],
  );

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedSceneId) || null,
    [scenarios, selectedSceneId],
  );

  const selectedEdgeNode = useMemo(() => {
    if (!deploymentTarget.startsWith("edge:")) return null;
    return edgeNodes.find((node) => `edge:${node.id}` === deploymentTarget) || null;
  }, [deploymentTarget, edgeNodes]);
  const edgeCompatibility: EdgeCompatibility | null = selectedEdgeNode?.compatibility || null;
  const requiresCamera = selectedAlgorithm?.inputs?.includes("/camera/image") === true;

  const clusterReady =
    readiness?.dependencies?.kubernetes?.reachable === true &&
    readiness?.dependencies?.artifact_store?.reachable === true;
  const runActive = Boolean(
    (deploymentTarget === "local" && run && activeRunStatuses.has(run.status)) ||
    (deploymentTarget !== "local" && edgeRun && activeEdgeStatuses.has(edgeRun.status)),
  );
  const actionBusy = actionStage !== "idle";
  const canStart = Boolean(
    selectedAlgorithm &&
    selectedPipeline &&
    selectedRobot &&
    siteCode.trim() &&
    !actionBusy &&
    !runActive &&
    (deploymentTarget === "local" ? clusterReady : edgeCompatibility?.runnable === true),
  );
  const targetReady = deploymentTarget === "local" ? clusterReady : edgeCompatibility?.runnable === true;
  const targetStatusText = deploymentTarget === "local"
    ? (clusterReady ? "验收集群可用" : "验收集群不可用")
    : selectedEdgeNode
      ? (targetReady ? `${selectedEdgeNode.name} 可部署` : `${selectedEdgeNode.name} 不满足条件`)
      : "未选择机器人";

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [catalogResponse, readinessResponse, edgeNodesResponse] = await Promise.all([
        deploymentApi.getCatalog(),
        platformApi.getReadiness().catch(() => null),
        edgeApi.getNodes().catch(() => null),
      ]);
      const catalog = resultOf<DeliveryCatalog>(catalogResponse) || {};
      const nextAlgorithms = catalog.algorithms || [];
      const nextPipelines = catalog.pipelines || [];
      const nextRobots = catalog.robots || [];
      const nextScenarios = catalog.scenarios || [];
      setAlgorithms(nextAlgorithms);
      setPipelines(nextPipelines);
      setRobots(nextRobots);
      setScenarios(nextScenarios);
      setReadiness(readinessResponse as PlatformReadiness | null);
      setEdgeNodes(edgeNodesResponse?.result?.data || []);

      const nextDeliverables = nextAlgorithms.filter(isBlackBoxDelivery);
      const initialAlgorithm =
        nextDeliverables.find((algorithm) => Number(algorithm.id) === 121) ||
        nextDeliverables.find((algorithm) => algorithm.status === "ready") ||
        nextDeliverables[0];
      if (initialAlgorithm) {
        setSelectedAlgorithmId(String(initialAlgorithm.id));
        setSelectedSceneId(preferredScene(initialAlgorithm));
        setSelectedRobotId(preferredRobotId(initialAlgorithm, nextRobots));
      }
    } catch (error) {
      console.error("Load quick deployment page failed:", error);
      setLoadError(error instanceof Error ? error.message : "无法读取平台资产");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedAlgorithmId) return;
    let cancelled = false;
    const refreshNodes = async () => {
      try {
        const response = await edgeApi.getNodes(selectedAlgorithmId);
        if (!cancelled) setEdgeNodes(response.result.data || []);
      } catch (error) {
        console.error("Load edge node compatibility failed:", error);
        if (!cancelled) setEdgeNodes([]);
      }
    };
    void refreshNodes();
    const timer = window.setInterval(refreshNodes, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedAlgorithmId]);

  useEffect(() => {
    if (!run?.id || !activeRunStatuses.has(run.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await deploymentApi.getRun(run.id);
        const nextRun = resultOf<DeploymentRun>(response);
        if (!nextRun) return;
        setRun(nextRun);
        if (!activeRunStatuses.has(nextRun.status)) {
          toast({
            title: nextRun.outcome?.publishable ? "验收通过" : "验收结束",
            description: nextRun.outcome?.reason || "Workflow 已结束，请查看运行结论。",
            variant: nextRun.status === "failed" ? "destructive" : "default",
          });
        }
      } catch (error) {
        console.error("Poll deployment run failed:", error);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, toast]);

  useEffect(() => {
    if (!edgeRun?.id || !activeEdgeStatuses.has(edgeRun.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await edgeApi.getDeployment(edgeRun.id);
        const nextRun = response.result;
        setEdgeRun(nextRun);
        if (!activeEdgeStatuses.has(nextRun.status)) {
          toast({
            title: nextRun.status === "succeeded" ? "真机部署已完成" : "真机部署已结束",
            description: nextRun.message || `机器人回报状态：${nextRun.status}`,
            variant: nextRun.status === "failed" ? "destructive" : "default",
          });
        }
      } catch (error) {
        console.error("Poll edge deployment failed:", error);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [edgeRun?.id, edgeRun?.status, toast]);

  const selectAlgorithm = (algorithmId: string) => {
    const algorithm = deliverableAlgorithms.find((item) => String(item.id) === algorithmId);
    if (!algorithm) return;
    setSelectedAlgorithmId(algorithmId);
    setSelectedSceneId(preferredScene(algorithm));
    setSelectedRobotId(selectedEdgeNode ? String(selectedEdgeNode.robot_id) : preferredRobotId(algorithm, robots));
    setReport(null);
    setRun(null);
    setEdgeRun(null);
    setActionError("");
  };

  const selectTarget = (target: DeploymentTarget) => {
    setDeploymentTarget(target);
    setReport(null);
    setRun(null);
    setEdgeRun(null);
    setActionError("");
    if (target.startsWith("edge:")) {
      const node = edgeNodes.find((item) => `edge:${item.id}` === target);
      if (node) setSelectedRobotId(String(node.robot_id));
    } else if (selectedAlgorithm) {
      setSelectedRobotId(preferredRobotId(selectedAlgorithm, robots));
    }
  };

  const stopCamera = useCallback(() => {
    if (cameraTimerRef.current !== null) {
      window.clearInterval(cameraTimerRef.current);
      cameraTimerRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    cameraUploadingRef.current = false;
    setCameraState("idle");
    setCameraMessage("");
    setCameraSequence(0);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    stopCamera();
  }, [deploymentTarget, selectedAlgorithmId, stopCamera]);

  const startCamera = async () => {
    if (!selectedEdgeNode) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraMessage("当前地址不能访问摄像头。请在本机使用 http://127.0.0.1:3001，或为局域网页面配置 HTTPS。");
      return;
    }
    setCameraState("starting");
    setCameraMessage("正在请求浏览器摄像头权限…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("摄像头预览组件未就绪");
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement("canvas");
      const capture = async () => {
        if (cameraUploadingRef.current || !video.videoWidth || !video.videoHeight) return;
        cameraUploadingRef.current = true;
        try {
          const width = 480;
          const height = Math.max(16, Math.min(360, Math.round(width * video.videoHeight / video.videoWidth)));
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("浏览器无法创建摄像头画布");
          context.drawImage(video, 0, 0, width, height);
          const rgba = context.getImageData(0, 0, width, height).data;
          const rgb = new Uint8Array(width * height * 3);
          for (let source = 0, target = 0; source < rgba.length; source += 4) {
            rgb[target++] = rgba[source];
            rgb[target++] = rgba[source + 1];
            rgb[target++] = rgba[source + 2];
          }
          const response = await edgeApi.pushCameraFrame(selectedEdgeNode.id, {
            encoding: "rgb8",
            width,
            height,
            step: width * 3,
            data_base64: bytesToBase64(rgb),
            captured_at: new Date().toISOString(),
          });
          setCameraSequence(response.result.sequence);
          setCameraState("streaming");
          setCameraMessage(`正在向 ${selectedEdgeNode.name} 提供真实帧；ROS 2 Topic 将在下次心跳后出现。`);
        } catch (error) {
          setCameraState("error");
          setCameraMessage(error instanceof Error ? error.message : "摄像头帧上传失败");
        } finally {
          cameraUploadingRef.current = false;
        }
      };
      await capture();
      cameraTimerRef.current = window.setInterval(() => void capture(), 500);
    } catch (error) {
      stopCamera();
      setCameraState("error");
      setCameraMessage(error instanceof Error ? error.message : "未获得摄像头权限");
    }
  };

  const handleStart = async () => {
    if (!canStart || !selectedAlgorithm || !selectedPipeline || !selectedRobot) return;
    setActionError("");
    setReport(null);
    setRun(null);
    setEdgeRun(null);
    setActionStage(deploymentTarget === "local" ? "preflight" : "submitting");
    try {
      if (deploymentTarget !== "local") {
        if (!selectedEdgeNode) throw new Error("请选择已登记的机器人 Edge 节点");
        const response = await edgeApi.createDeployment({
          node_id: selectedEdgeNode.id,
          algorithm_id: selectedAlgorithm.id,
          pipeline_id: selectedPipeline.id,
          site_code: siteCode.trim(),
          parameters: { scene: selectedSceneId },
        });
        setEdgeRun(response.result);
        toast({
          title: "已下发到机器人任务队列",
          description: "只有机器人 Agent 实际回报后，页面才会显示拉取、启动或运行成功。",
        });
        return;
      }

      const preflightResponse = await simulationApi.preflight({
        algorithms: [{ id: selectedAlgorithm.id, version: selectedAlgorithm.version }],
        scene: selectedSceneId,
        robot: selectedRobot,
        pipeline_id: selectedPipeline.id,
      });
      const nextReport = resultOf<CompatibilityReport>(preflightResponse);
      if (!nextReport) throw new Error("预检接口未返回兼容性报告");
      setReport(nextReport);
      if (!nextReport.runnable) return;

      setActionStage("submitting");
      const runResponse = await deploymentApi.run({
        workflow_name: `${siteCode.trim()}-${selectedAlgorithm.name}-${selectedAlgorithm.status === "quarantined" ? "资格验收" : "部署验收"}`,
        pipeline_id: selectedPipeline.id,
        robot: selectedRobot,
        algorithms: [{ id: selectedAlgorithm.id, version: selectedAlgorithm.version }],
        scene: selectedSceneId,
        seed: 20260826,
        fault_mode: "none",
      });
      const nextRun = resultOf<DeploymentRun>(runResponse);
      if (!nextRun) throw new Error("运行接口未返回 Workflow 记录");
      setRun(nextRun);
      toast({
        title: selectedAlgorithm.status === "quarantined" ? "已提交资格验收" : "已提交运行",
        description: `Argo Workflow：${nextRun.remote_workflow?.name || nextRun.id}`,
      });
    } catch (error) {
      console.error("Quick deployment failed:", error);
      const message = error instanceof Error ? error.message : "无法提交真实 Argo Workflow";
      setActionError(message);
      toast({ title: "运行失败", description: message, variant: "destructive" });
    } finally {
      setActionStage("idle");
    }
  };

  const handleStop = async () => {
    if (!runActive) return;
    try {
      if (deploymentTarget !== "local") {
        if (!edgeRun?.id) return;
        const response = await edgeApi.stopDeployment(edgeRun.id);
        setEdgeRun(response.result);
        toast({ title: "已提交停止请求", description: "等待机器人 Agent 停止容器并回报结果。" });
        return;
      }
      if (!run?.id) return;
      const response = await deploymentApi.cancelRun(run.id, Number(run.revision || 1));
      const nextRun = resultOf<DeploymentRun>(response);
      if (nextRun) setRun(nextRun);
      toast({ title: "已提交停止请求", description: "平台正在终止真实 Argo Workflow。" });
    } catch (error) {
      toast({
        title: "停止失败",
        description: error instanceof Error ? error.message : "无法停止 Workflow",
        variant: "destructive",
      });
    }
  };

  const exportContract = () => {
    if (!selectedAlgorithm || !selectedPipeline || !selectedRobot) return;
    const contract = {
      api_version: "cloud-bot-flow/v1",
      kind: "BlackBoxAlgorithmDelivery",
      metadata: {
        name: selectedAlgorithm.name,
        version: selectedAlgorithm.version,
        site_code: siteCode.trim() || "UNASSIGNED",
      },
      artifact: {
        type: "oci-image",
        immutable_ref: selectedAlgorithm.image,
        digest: selectedAlgorithm.image_digest || selectedAlgorithm.image.split("@")[1] || null,
        source_included: false,
      },
      interface: {
        kind: interfaceKind(selectedAlgorithm),
        inputs: selectedAlgorithm.inputs.map((name) => ({
          name,
          type: selectedAlgorithm.input_types?.[name] || "untyped",
        })),
        outputs: selectedAlgorithm.outputs.map((name) => ({
          name,
          type: selectedAlgorithm.output_types?.[name] || "artifact",
        })),
      },
      binding: {
        target: deploymentTarget === "local" ? "local-validation-cluster" : "edge-robot",
        namespace: "pipeline",
        scene: { id: selectedSceneId, version: selectedScenario?.version || null },
        robot: { id: selectedRobot.id, name: selectedRobot.name, model: selectedRobot.model },
        edge_node: selectedEdgeNode ? {
          id: selectedEdgeNode.id,
          architecture: selectedEdgeNode.architecture,
          agent_version: selectedEdgeNode.agent_version,
        } : null,
        pipeline: { id: selectedPipeline.id, name: selectedPipeline.name },
      },
      release_policy: {
        immutable_digest_required: true,
        preflight_required: true,
        evidence_required: true,
        source_paths_exported: false,
        latest_preflight: report
          ? { runnable: report.runnable, publishable_candidate: report.publishable_candidate, score: report.score }
          : null,
        latest_validation_run: run
          ? {
              id: run.id,
              status: run.status,
              publishable: run.outcome?.publishable ?? null,
              integrity_verified: run.evidence?.integrity?.verified ?? null,
            }
          : edgeRun ? { id: edgeRun.id, status: edgeRun.status } : null,
      },
    };
    const blob = new Blob([`${JSON.stringify(contract, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedAlgorithm.name.replace(/[\\/:*?"<>|\s]+/g, "-")}-delivery.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: "交付合同已导出", description: "文件仅包含接口和部署绑定，不包含源码路径或启动命令。" });
  };

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">正在读取算法和集群状态…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-center">
        <XCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
        <p className="font-medium">页面加载失败</p>
        <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
        <Button className="mt-4" variant="outline" onClick={() => void loadData()}>
          <RefreshCw className="mr-2 h-4 w-4" />重试
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge className="gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />黑盒交付</Badge>
            <Badge variant="outline">仅暴露接口</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">算法快速部署</h1>
          <p className="mt-1 text-sm text-muted-foreground">选择算法，确认门店编号，然后一次点击完成预检和运行。</p>
        </div>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${targetReady ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          <span className={`h-2 w-2 rounded-full ${targetReady ? "bg-emerald-500" : "bg-destructive"}`} />
          {targetStatusText}
        </div>
      </header>

      {deploymentTarget === "local" && !clusterReady && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">暂时不能运行</p>
            <p className="mt-1 text-muted-foreground">需要 Kubernetes 和 MinIO 同时可用。页面不会在基础设施离线时伪造部署成功。</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">运行配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <section className="space-y-2">
              <Label htmlFor="algorithm-select"><span className="mr-2 font-mono text-primary">1</span>选择算法</Label>
              <Select value={selectedAlgorithmId} onValueChange={selectAlgorithm}>
                <SelectTrigger id="algorithm-select" className="h-11">
                  <SelectValue placeholder="请选择一个算法" />
                </SelectTrigger>
                <SelectContent>
                  {deliverableAlgorithms.map((algorithm) => (
                    <SelectItem key={algorithm.id} value={String(algorithm.id)}>
                      {algorithm.name}{algorithm.status === "quarantined" ? "（仅资格验收）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAlgorithm && (
                <div className="rounded-lg bg-muted/45 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{selectedAlgorithm.module}</span>
                    <Badge variant="outline">{formatVersion(selectedAlgorithm.version)}</Badge>
                    <Badge className={selectedAlgorithm.status === "quarantined" ? "bg-amber-600 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-600"}>
                      {selectedAlgorithm.status === "quarantined" ? "隔离" : "可运行"}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-1 text-sm leading-5 text-muted-foreground">{selectedAlgorithm.description}</p>
                </div>
              )}
            </section>

            <section className="space-y-2 border-t pt-4">
              <Label htmlFor="site-code"><span className="mr-2 font-mono text-primary">2</span>确认部署位置</Label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <Input
                  id="site-code"
                  className="h-11"
                  value={siteCode}
                  onChange={(event) => setSiteCode(event.target.value)}
                  placeholder="例如 STORE-SH-001"
                />
                <Select value={deploymentTarget} onValueChange={(value) => selectTarget(value as DeploymentTarget)}>
                  <SelectTrigger className="h-11" aria-label="部署目标">
                    <SelectValue placeholder="选择本地集群或机器人" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">本地验收集群（{clusterReady ? "可用" : "离线"}）</SelectItem>
                    {edgeNodes.map((node) => (
                      <SelectItem key={node.id} value={`edge:${node.id}`}>
                        {node.name}（{node.online ? "在线" : "离线"}，{node.ip_address}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {deploymentTarget === "local"
                  ? "在本机 Kubernetes / Argo 中做交付验收，不会部署到机器人。"
                  : "浏览器只请求平台后端；机器人 Agent 主动领取任务，平台不会从浏览器直连机器人 IP。"}
              </p>
              {edgeNodes.length === 0 && (
                <p className="text-xs text-amber-600">暂无已登记的机器人 Agent；安装并启动 Agent 后会自动出现在目标列表。</p>
              )}
            </section>

            {deploymentTarget !== "local" && selectedEdgeNode && requiresCamera && (
              <section className="space-y-3 border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium"><Camera className="mr-2 inline h-4 w-4" />本机摄像头输入</p>
                    <p className="mt-1 text-xs text-muted-foreground">网页采集真实画面，WSL/机器人 Agent 发布为 `/camera/image`。</p>
                  </div>
                  {cameraState === "streaming" ? (
                    <Button type="button" size="sm" variant="outline" onClick={stopCamera}>
                      <CameraOff className="mr-2 h-4 w-4" />停止摄像头
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => void startCamera()} disabled={cameraState === "starting"}>
                      {cameraState === "starting" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                      启用本机摄像头
                    </Button>
                  )}
                </div>
                <div className="overflow-hidden rounded-lg border bg-black">
                  <video ref={videoRef} className="aspect-video w-full object-contain" autoPlay playsInline muted />
                </div>
                {cameraMessage && (
                  <p className={`text-xs ${cameraState === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                    {cameraMessage}{cameraSequence ? ` 当前帧 #${cameraSequence}` : ""}
                  </p>
                )}
              </section>
            )}

            <section className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium"><span className="mr-2 font-mono text-primary">3</span>平台自动匹配</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <AutoBinding label="场景" value={selectedScenario?.label || "未匹配"} />
                <AutoBinding label="机器人" value={selectedRobot?.name || "未匹配"} />
                <AutoBinding label="Pipeline" value={selectedPipeline?.name || "未绑定"} danger={!selectedPipeline} />
              </div>
            </section>

            {selectedAlgorithm?.status === "quarantined" && (
              <div className="flex gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p><span className="font-medium">该镜像只能做资格验收。</span> 验收 Workflow 可以运行，但不会被标记为可发布算法。</p>
              </div>
            )}

            {deploymentTarget !== "local" && selectedEdgeNode && edgeCompatibility && !edgeCompatibility.runnable && (
              <div className="rounded-lg border border-destructive/35 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <XCircle className="h-4 w-4" />当前不能部署到该机器人
                </div>
                <ul className="mt-2 space-y-1.5 text-muted-foreground">
                  {edgeCompatibility.blockers.map((blocker) => (
                    <li key={blocker.code}>• {blocker.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button className="h-11 w-full" onClick={handleStart} disabled={!canStart}>
              {actionBusy || runActive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {actionStage === "preflight"
                ? "正在预检…"
                : actionStage === "submitting"
                  ? "正在提交…"
                  : runActive
                    ? (deploymentTarget === "local" ? "Workflow 运行中" : "机器人任务执行中")
                    : selectedAlgorithm?.status === "quarantined"
                      ? "执行资格验收"
                      : deploymentTarget === "local" ? "预检并运行" : "部署到机器人"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">运行状态</CardTitle>
          </CardHeader>
          <CardContent>
            {actionBusy ? (
              <StatusPlaceholder
                icon={Loader2}
                spinning
                title={actionStage === "preflight" ? "正在检查接口和运行条件" : deploymentTarget === "local" ? "正在提交 Argo Workflow" : "正在创建机器人部署任务"}
                detail="完成后会自动在这里显示进度和验收结果。"
              />
            ) : actionError ? (
              <StatusPlaceholder icon={XCircle} destructive title="提交失败" detail={actionError} />
            ) : report && !report.runnable ? (
              <StatusPlaceholder
                icon={XCircle}
                destructive
                title="预检未通过"
                detail={report.errors[0] || "当前算法、场景或机器人不兼容。"}
              />
            ) : deploymentTarget !== "local" && edgeRun ? (
              <EdgeRunStatus run={edgeRun} node={selectedEdgeNode} onStop={handleStop} />
            ) : run ? (
              <RunStatus run={run} onStop={handleStop} />
            ) : (
              <StatusPlaceholder
                icon={CircleDashed}
                title="等待运行"
                detail="左侧选择算法并点击运行按钮，平台会自动完成预检和后续步骤。"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium">
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />查看接口与交付信息</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        {selectedAlgorithm && (
          <div className="grid gap-5 border-t px-5 py-5 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">不可变运行制品</h2>
              <DetailRow icon={Container} label="镜像" value={imageName(selectedAlgorithm.image)} />
              <DetailRow icon={ShieldCheck} label="摘要" value={shortDigest(selectedAlgorithm.image_digest || selectedAlgorithm.image.split("@")[1])} mono />
              <DetailRow icon={Server} label="环境" value={selectedAlgorithm.runtime || "未声明"} />
              <div className="rounded-lg bg-muted/45 p-3 text-xs leading-5 text-muted-foreground">
                页面和导出的合同不返回源码路径、仓库地址、启动命令或 Workflow 源文件。
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">公开接口 · {interfaceKind(selectedAlgorithm)}</h2>
                <Button size="sm" variant="outline" onClick={exportContract} disabled={!selectedPipeline || !selectedRobot}>
                  <Download className="mr-2 h-3.5 w-3.5" />导出合同
                </Button>
              </div>
              <InterfaceList title="输入" items={selectedAlgorithm.inputs} types={selectedAlgorithm.input_types} emptyText="无公开输入" />
              <InterfaceList title="输出" items={selectedAlgorithm.outputs} types={selectedAlgorithm.output_types} emptyText="无公开输出" />
            </section>
          </div>
        )}
      </details>
    </div>
  );
}

function AutoBinding({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border p-2.5 ${danger ? "border-destructive/50 bg-destructive/5" : "bg-muted/25"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 line-clamp-2 text-sm font-medium ${danger ? "text-destructive" : ""}`} title={value}>{value}</p>
    </div>
  );
}

function StatusPlaceholder({
  icon: Icon,
  title,
  detail,
  spinning = false,
  destructive = false,
}: {
  icon: typeof CircleDashed;
  title: string;
  detail: string;
  spinning?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="grid min-h-[300px] place-items-center rounded-xl border border-dashed p-6 text-center">
      <div>
        <Icon className={`mx-auto mb-3 h-7 w-7 ${spinning ? "animate-spin" : ""} ${destructive ? "text-destructive" : "text-muted-foreground"}`} />
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function EdgeRunStatus({ run, node, onStop }: { run: EdgeDeployment; node: EdgeNode | null; onStop: () => void }) {
  const active = activeEdgeStatuses.has(run.status);
  const failed = run.status === "failed";
  const succeeded = run.status === "succeeded";
  const Icon = active ? Loader2 : failed ? XCircle : succeeded ? CheckCircle2 : AlertTriangle;
  const tone = failed ? "text-destructive" : succeeded ? "text-emerald-500" : "text-primary";

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${failed ? "border-destructive/35 bg-destructive/5" : succeeded ? "border-emerald-500/35 bg-emerald-500/10" : "bg-muted/25"}`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${active ? "animate-spin" : ""} ${tone}`} />
          <div className="min-w-0">
            <p className="font-semibold">{statusLabel[run.status] || run.status}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{run.message || "等待机器人 Agent 回报真实容器状态。"}</p>
          </div>
        </div>
      </div>

      <dl className="space-y-2 rounded-lg border p-3 text-sm">
        <RunDetail label="部署编号" value={run.id} mono />
        <RunDetail label="目标机器人" value={node ? `${node.name} · ${node.ip_address}` : run.node_id} />
        <RunDetail label="Agent 状态" value={node?.online ? "在线" : "离线"} good={node?.online === true} warning={node?.online !== true} />
        <RunDetail label="当前阶段" value={statusLabel[run.status] || run.status} />
      </dl>

      {active && (
        <Button variant="outline" className="w-full" onClick={onStop} disabled={run.status === "stop_requested"}>
          <Square className="mr-2 h-4 w-4" />{run.status === "stop_requested" ? "等待机器人停止" : "停止机器人容器"}
        </Button>
      )}
    </div>
  );
}

function RunStatus({ run, onStop }: { run: DeploymentRun; onStop: () => void }) {
  const active = activeRunStatuses.has(run.status);
  const failed = run.status === "failed" || run.status === "canceled";
  const publishable = run.outcome?.publishable === true;
  const completedButBlocked = run.status === "completed" && !publishable;
  const Icon = active ? Loader2 : failed ? XCircle : publishable ? CheckCircle2 : AlertTriangle;
  const tone = failed ? "text-destructive" : completedButBlocked ? "text-amber-500" : publishable ? "text-emerald-500" : "text-primary";

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${failed ? "border-destructive/35 bg-destructive/5" : completedButBlocked ? "border-amber-500/35 bg-amber-500/10" : publishable ? "border-emerald-500/35 bg-emerald-500/10" : "bg-muted/25"}`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${active ? "animate-spin" : ""} ${tone}`} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{statusLabel[run.status] || run.status}</p>
              {publishable && <Badge className="bg-emerald-600 hover:bg-emerald-600">可发布</Badge>}
              {completedButBlocked && <Badge className="bg-amber-600 hover:bg-amber-600">不可发布</Badge>}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {run.outcome?.reason || (active ? "真实 Argo Workflow 正在执行。" : "Workflow 已结束。")}
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>执行进度</span>
          <span className="font-mono">{Math.max(0, Math.min(100, Number(run.progress || 0)))}%</span>
        </div>
        <Progress value={Math.max(0, Math.min(100, Number(run.progress || 0)))} />
      </div>

      <dl className="space-y-2 rounded-lg border p-3 text-sm">
        <RunDetail label="Workflow" value={run.remote_workflow?.name || run.id} mono />
        <RunDetail label="运行阶段" value={run.remote_workflow?.phase || statusLabel[run.status] || run.status} />
        <RunDetail
          label="证据校验"
          value={run.evidence?.integrity?.verified === true ? "SHA-256 已验证" : active ? "等待生成" : "未通过"}
          good={run.evidence?.integrity?.verified === true}
        />
        {Number(run.evidence?.blocker_count || 0) > 0 && (
          <RunDetail
            label={publishable ? "待接入项" : "阻断项"}
            value={`${run.evidence?.blocker_count} 项`}
            warning
          />
        )}
      </dl>

      {active && (
        <Button variant="outline" className="w-full" onClick={onStop}>
          <Square className="mr-2 h-4 w-4" />停止 Workflow
        </Button>
      )}
    </div>
  );
}

function RunDetail({ label, value, mono = false, good = false, warning = false }: { label: string; value: string; mono?: boolean; good?: boolean; warning?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""} ${good ? "text-emerald-500" : warning ? "text-amber-500" : ""}`}>{value}</dd>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, mono = false }: { icon: typeof Container; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 break-all ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</p>
      </div>
    </div>
  );
}

function InterfaceList({ title, items, types, emptyText }: { title: string; items: string[]; types?: Record<string, string>; emptyText: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <code className="text-primary">{item}</code>
              <span className="text-muted-foreground">{types?.[item] || "未声明类型"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}
