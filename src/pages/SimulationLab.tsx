import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Container,
  Cpu,
  ExternalLink,
  Gauge,
  GripVertical,
  MonitorPlay,
  Pause,
  Play,
  RotateCcw,
  Terminal,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { resourceApi, simulationAlgorithmApi, simulationApi } from "@/services/api";
import "./SimulationLab.css";

interface SimulationAlgorithm {
  id: string | number;
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
}

interface Robot {
  id: string | number;
  name: string;
  model: string;
}

interface SimulationWorkflow {
  name?: string;
  algorithms?: Array<{
    id?: string | number;
    assetId?: string | number;
    name: string;
    displayName?: string;
  } | string>;
  robots?: Array<{ id?: string | number; name: string }>;
  monitoringData?: any;
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
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

interface CompatibilityReport {
  runnable: boolean;
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
  robot?: Robot;
  algorithms?: SimulationAlgorithm[];
  scene?: string;
  provider?: { id: string; label: string; evidence_level: string };
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
}

const initialLogs = [
  "[system] 编排演练服务已就绪",
  "[provider] 等待加入算法规格",
  "[scene] warehouse 场景规格加载完成",
];

const containerPhaseLabel: Record<string, string> = {
  queued: "等待",
  pulling: "装载适配器",
  starting: "启动中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
};

const getContainerPhase = (
  simulationStatus: SimulationStatus,
  progress: number,
  index: number,
) => {
  if (simulationStatus === "failed") return "failed";
  if (simulationStatus === "completed") return "completed";
  if (simulationStatus === "paused") return "paused";
  if (simulationStatus === "idle" || simulationStatus === "validating") return "queued";
  const offset = index * 3;
  if (progress < 10 + offset) return "pulling";
  if (progress < 24 + offset) return "starting";
  return "running";
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

  const workflow = useMemo<SimulationWorkflow>(() => {
    const stateWorkflow = (location.state as any)?.simulationData;
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

        const incomingRobot = workflow.robots?.[0];
        const matchedRobot = (robotResponse || []).find(
          (robot: Robot) =>
            String(robot.id) === String(incomingRobot?.id || "") ||
            robot.name === incomingRobot?.name,
        );
        setSelectedRobotId(String(matchedRobot?.id || robotResponse?.[0]?.id || ""));

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
        if (!terminal) {
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

  const compositionLocked = ["validating", "running", "paused"].includes(status);

  const addAlgorithm = (id: string | number) => {
    if (compositionLocked) return;
    setCompatibility(null);
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
    setCompatibility(null);
    setSelectedAlgorithmIds((prev) => prev.filter((item) => String(item) !== String(id)));
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

    try {
      setStatus("validating");
      setLogs((prev) => [
        ...prev,
        `[preflight] 正在校验 ${selectedAlgorithms.length} 个算法的镜像规格与 ROS 接口`,
      ]);
      const preflightResponse = await simulationApi.preflight({
        algorithms: selectedAlgorithms,
        scene: selectedScene,
        robot: selectedRobot,
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
        robot: selectedRobot,
        algorithms: selectedAlgorithms,
        scene: selectedScene,
        seed,
        fault_mode: faultMode,
      });
      setRunId(response.result.id);
      setRunSnapshot(response.result as SimulationRun);
      sessionStorage.setItem("activeSimulationRunId", response.result.id);
      setProgress(0);
      setStatus("running");
      setLogs([
        `[preflight] 接口预检通过，${report.warnings.length} 条部署提示`,
        `[run] 创建仿真实例 ${response.result.id}`,
        `[robot] 加载机器人 ${selectedRobot.name} (${selectedRobot.model})`,
        `[manifest] seed=${seed} · fault=${faultMode} · sha256=${String(response.result.run_manifest?.sha256 || "").slice(0, 12)}`,
        ...selectedAlgorithms.map((algorithm) =>
          algorithm.image_status === "build-required"
            ? `[adapter] 加载 ${algorithm.name} 编排演练适配器（真实镜像待 CI 构建）`
            : `[rehearsal] 装载 ${algorithm.image} 规格`,
        ),
        "[clock] 合成演练时钟开始运行",
      ]);
      toast({
        title: "编排演练已启动",
        description: `${selectedAlgorithms.length} 个算法规格正在演练`,
      });
    } catch (error) {
      console.error("Start simulation failed:", error);
      setStatus("failed");
      toast({
        title: "启动失败",
        description: error instanceof Error ? error.message : "仿真运行接口返回错误",
        variant: "destructive",
      });
    }
  };

  const pauseSimulation = async () => {
    if (!runId || !runSnapshot) return;
    try {
      const response = await simulationApi.controlRun(
        runId,
        "pause",
        runSnapshot.revision,
      );
      setRunSnapshot(response.result as SimulationRun);
      setStatus(response.result.status);
      setProgress(response.result.progress);
    } catch (error) {
      toast({ title: "暂停失败", description: String(error), variant: "destructive" });
    }
  };

  const resumeSimulation = async () => {
    if (!runId || !runSnapshot) return;
    try {
      const response = await simulationApi.controlRun(
        runId,
        "resume",
        runSnapshot.revision,
      );
      setRunSnapshot(response.result as SimulationRun);
      setStatus(response.result.status);
      setProgress(response.result.progress);
    } catch (error) {
      toast({ title: "恢复失败", description: String(error), variant: "destructive" });
    }
  };

  const resetSimulation = async () => {
    if (runId && runSnapshot && ["running", "paused"].includes(status)) {
      try {
        await simulationApi.controlRun(runId, "cancel", runSnapshot.revision);
      } catch (error) {
        toast({
          title: "取消失败",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
        return;
      }
    }
    sessionStorage.removeItem("activeSimulationRunId");
    setStatus("idle");
    setProgress(0);
    setRunId(null);
    setRunSnapshot(null);
    setCompatibility(null);
    setLogs(initialLogs);
  };

  const metricValue = (name: string) => runSnapshot?.metrics?.[name]?.value ?? null;
  const rehearsalRate = metricValue("rehearsal_rate");
  const simTime = Number(metricValue("sim_time") || 0);
  const poseX = Number(runSnapshot?.pose?.x || 0);
  const poseY = Number(runSnapshot?.pose?.y || 0);
  const robotLeft = Math.min(80, 8 + poseX * 9);
  const robotTop = Math.max(25, Math.min(78, 60 - poseY * 9));

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <MonitorPlay className="h-4 w-4" />
            Docker / ROS 算法规格编排
          </div>
          <h1 className="text-3xl font-bold">机器人仿真实验室</h1>
          <p className="mt-2 text-muted-foreground">
            将封装好的算法规格加入运行链，先做 ROS 接口预检，再启动可视化编排演练。
          </p>
          <div className="mt-3 flex max-w-3xl items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            当前为服务端驱动的合成编排演练，不产生碰撞、性能或算法正确性的真实结论；正式验收仍需 Docker + ROS 2 + Gazebo 执行器。
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === "running" ? (
            <Button variant="outline" onClick={pauseSimulation}>
              <Pause className="mr-2 h-4 w-4" />暂停
            </Button>
          ) : status === "paused" ? (
            <Button variant="outline" onClick={resumeSimulation}>
              <Play className="mr-2 h-4 w-4" />继续
            </Button>
          ) : (
            <Button
              onClick={startSimulation}
              disabled={selectedAlgorithms.length === 0 || status === "validating"}
            >
              <Play className="mr-2 h-4 w-4" />
              {status === "validating" ? "正在预检" : "启动演练"}
            </Button>
          )}
          <Button variant="outline" onClick={resetSimulation}>
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

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        <Card className="xl:h-[730px]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Container className="h-4 w-4" />
              仿真算法库
            </CardTitle>
            <p className="text-xs text-muted-foreground">拖动本地镜像或 GitHub 算法规格到运行链</p>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[620px] pr-3">
              <div className="space-y-3">
                {algorithms.map((algorithm) => {
                  const isSelected = selectedAlgorithmIds.some(
                    (id) => String(id) === String(algorithm.id),
                  );
                  return (
                    <div
                      key={algorithm.id}
                      draggable={!compositionLocked}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("simulation-algorithm-id", String(algorithm.id));
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onDoubleClick={() => addAlgorithm(algorithm.id)}
                      className={`cursor-grab rounded-xl border p-3 transition ${
                        isSelected ? "border-primary/50 bg-primary/10" : "hover:border-primary/40 hover:bg-accent"
                      }`}
                      aria-disabled={compositionLocked}
                    >
                      <div className="flex items-start gap-3">
                        <GripVertical className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold">{algorithm.name}</span>
                            <span
                              className={`h-2 w-2 rounded-full ${
                                algorithm.status === "verified-source"
                                  ? "bg-amber-400"
                                  : "bg-emerald-400"
                              }`}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{algorithm.module}</p>
                          <div className="mt-2 truncate rounded bg-background/70 px-2 py-1 font-mono text-[10px]">
                            {algorithm.image}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                              {algorithm.status === "verified-source" ? "源码已验证" : "本地镜像"}
                            </Badge>
                            {algorithm.license && (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
                                {algorithm.license}
                              </Badge>
                            )}
                            {algorithm.repository_url && (
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
                              disabled={compositionLocked || isSelected}
                              onClick={() => addAlgorithm(algorithm.id)}
                            >
                              {isSelected ? "已加入" : "加入运行链"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-4 w-4" />
                  容器运行链
                </CardTitle>
                <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
                  <div className="w-full sm:w-52">
                    <Select
                      value={selectedScene}
                      onValueChange={setSelectedScene}
                      disabled={compositionLocked}
                    >
                      <SelectTrigger aria-label="选择演练场景">
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
                      onValueChange={(value) => setFaultMode(value as typeof faultMode)}
                      disabled={compositionLocked}
                    >
                      <SelectTrigger aria-label="选择故障演练">
                        <SelectValue placeholder="故障演练" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">无故障注入</SelectItem>
                        <SelectItem value="sensor-dropout">传感器中断</SelectItem>
                        <SelectItem value="algorithm-timeout">算法超时</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
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
                    将左侧算法容器拖动到这里
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
                  {selectedScenario?.label || "演练场景"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">编排画布 · 非物理仿真</Badge>
                  <Badge
                    className={
                      status === "completed"
                        ? "bg-emerald-500/15 text-emerald-400"
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
                      ? "演练完成"
                      : status === "running"
                        ? "运行中"
                        : status === "paused"
                          ? "已暂停"
                          : status === "validating"
                            ? "接口预检"
                            : status === "failed"
                              ? "演练失败"
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
              <div className="simulation-world">
                <div className="simulation-grid" />
                <div className="warehouse-shelf shelf-a"><span>A-01</span></div>
                <div className="warehouse-shelf shelf-b"><span>B-07</span></div>
                <div className="warehouse-obstacle obstacle-a" />
                <div className="warehouse-obstacle obstacle-b" />
                <div className="target-zone">目标位</div>
                <div
                  className={`simulation-robot ${status === "running" ? "is-running" : ""}`}
                  style={{ left: `${robotLeft}%`, top: `${robotTop}%` }}
                >
                  <div className="robot-lidar" />
                  <div className="robot-body">
                    <span>{selectedRobot?.model || "ROBOT"}</span>
                  </div>
                  <div className="robot-wheel left" />
                  <div className="robot-wheel right" />
                  {status !== "idle" && <div className="robot-scan" />}
                </div>
                {status !== "idle" && (
                  <svg className="simulation-path" viewBox="0 0 1000 420" preserveAspectRatio="none">
                    <path d="M 90 290 C 250 290, 260 100, 470 165 S 760 330, 900 105" />
                  </svg>
                )}
                <div className="scene-overlay">
                  <div><span>X</span>{poseX.toFixed(2)} m</div>
                  <div><span>Y</span>{poseY.toFixed(2)} m</div>
                  <div><span>SIM</span>{simTime.toFixed(1)} s</div>
                </div>
              </div>
              <div className="border-t p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>编排演练进度</span>
                  <span className="font-mono">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
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
                <Badge variant="outline">浏览器编排演练 · 合成</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">演练速率（合成）</p>
                  <p className="mt-1 text-xl font-bold">
                    {rehearsalRate === null ? "—" : `${Number(rehearsalRate).toFixed(2)}x`}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">物理碰撞</p>
                  <p className="mt-1 text-xl font-bold text-muted-foreground">未测量</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">容器 CPU</p>
                  <p className="mt-1 text-xl font-bold text-muted-foreground">未连接</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">容器内存</p>
                  <p className="mt-1 text-xl font-bold text-muted-foreground">未连接</p>
                </div>
              </div>
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
                    {compatibility.runnable ? "ROS 接口预检通过" : "接口预检失败"}
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

          <Card className="h-[466px]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4" />
                容器日志
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[370px] rounded-lg border bg-slate-950 p-3">
                <div className="space-y-2 font-mono text-xs text-slate-300">
                  {logs.map((log, index) => (
                    <div key={`${index}-${log}`} className="flex gap-2">
                      <span className="select-none text-slate-600">{String(index + 1).padStart(2, "0")}</span>
                      <span
                        className={
                          log.includes("[result]")
                            ? "text-emerald-400"
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
                      {status === "validating" ? "正在校验算法接口..." : "正在接收仿真数据..."}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {status === "completed" && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-200">
              <CheckCircle2 className="h-5 w-5" />
              编排演练完成；结果仅为合成证据，不能发布为“算法验证通过”。
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
    </div>
  );
}
