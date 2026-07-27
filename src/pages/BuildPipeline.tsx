import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Box,
  CheckCircle2,
  CircleDashed,
  CloudCog,
  Container,
  Database,
  Download,
  GitBranch,
  Loader2,
  PackagePlus,
  Play,
  Plus,
  RefreshCw,
  ServerCog,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { codeRepositoryApi, pipelineApi, platformApi } from "@/services/api";

interface CodeModule {
  id: string | number;
  name: string;
  version: string;
  branch: string;
  repository_url: string;
  verified_commit?: string;
}

interface Pipeline {
  id: string | number;
  name: string;
  pipeline_url?: string;
  describe?: string;
}

interface ImageBuild {
  id: string;
  code_module_name: string;
  target_image: string;
  provider: string;
  evidence_level: string;
  status: string;
  phase: string;
  progress: number;
  submitted_at: string;
  build_manifest?: { sha256?: string | null };
}

interface RegistryImage {
  id: string;
  name: string;
  target_image: string;
  immutable_ref?: string | null;
  digest?: string | null;
  provider: string;
  evidence_level: string;
  runtime_verified: boolean;
  status: string;
  created_at: string;
}

interface PipelineRun {
  id: string;
  pipeline_name: string;
  provider: string;
  evidence_level: string;
  status: string;
  phase: string;
  progress: number;
  artifact_id?: string;
  tasks?: Array<{ name: string; status: string }>;
  submitted_at: string;
}

interface Artifact {
  id: string;
  name: string;
  run_id: string;
  storage: {
    provider: string;
    bucket?: string | null;
    object_key: string;
    size: number;
  };
  created_at: string;
}

interface PlatformCapabilities {
  configuration?: {
    cube_studio?: { mode?: string };
  };
  health?: {
    cube_studio?: {
      configured?: boolean;
      reachable?: boolean;
      mode?: string;
      message?: string;
    };
    artifact_store?: {
      reachable?: boolean;
      provider?: string;
      message?: string;
    };
  };
}

interface RegistryRepository {
  id: string | number;
  name: string;
  server: string;
  provider: string;
}

const statusText: Record<string, string> = {
  queued: "排队中",
  building: "构建中",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  submitted: "已提交",
  awaiting_cube_debug: "等待 Cube 调试保存",
  ready: "可用",
};

const unwrapList = <T,>(response: unknown): T[] => {
  const payload = response as { result?: { data?: T[] }; data?: T[] } | T[] | null;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const activeStatuses = new Set(["queued", "building", "running", "submitting", "awaiting_cube_debug"]);

function stripHtml(value?: string | null) {
  if (!value) return "";
  return value.replace(/<[^>]+>/g, "").trim();
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["succeeded", "ready"].includes(status)) return "default";
  if (status === "failed") return "destructive";
  if (["building", "running"].includes(status)) return "secondary";
  return "outline";
}

function normalizePipeline(row: Pipeline): Pipeline {
  const label =
    stripHtml(row.name) || stripHtml(row.describe) || stripHtml(row.pipeline_url) || `pipeline-${row.id}`;
  return { ...row, name: label };
}

function normalizeImage(row: RegistryImage): RegistryImage {
  const target = stripHtml(row.target_image) || stripHtml(row.immutable_ref) || "";
  const name = stripHtml(row.name) || target || `image-${row.id}`;
  return {
    ...row,
    name,
    target_image: target,
    digest: row.digest || null,
  };
}

export default function BuildPipeline() {
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const [codeModules, setCodeModules] = useState<CodeModule[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [builds, setBuilds] = useState<ImageBuild[]>([]);
  const [images, setImages] = useState<RegistryImage[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [repositories, setRepositories] = useState<RegistryRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingBuild, setSubmittingBuild] = useState(false);
  const [submittingRun, setSubmittingRun] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [baseImage, setBaseImage] = useState("ros:humble-ros-base");
  const [targetImage, setTargetImage] = useState("");
  const [dockerfile, setDockerfile] = useState("Dockerfile");
  const [repositoryForm, setRepositoryForm] = useState({
    name: "",
    server: "",
    user: "",
    password: "",
    hubsecret: "",
  });
  const { toast } = useToast();

  const loadData = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(null);
      try {
        const results = await Promise.allSettled([
          platformApi.getCapabilities(),
          codeRepositoryApi.getList(),
          pipelineApi.getList(),
          platformApi.getImageBuilds(),
          platformApi.getRegistryImages(),
          platformApi.getPipelineRuns(),
          platformApi.getArtifacts(),
          platformApi.getRepositories(),
        ]);

        const valueAt = <T,>(index: number): T | null => {
          const item = results[index];
          return item.status === "fulfilled" ? (item.value as T) : null;
        };

        const failures = results
          .map((item, index) => (item.status === "rejected" ? index : -1))
          .filter((index) => index >= 0);
        if (failures.length === results.length) {
          throw new Error("平台接口全部不可用，请确认适配层 3001 与 Cube Studio 已启动");
        }

        const capabilityResponse = valueAt<{ result?: PlatformCapabilities }>(0);
        const moduleResponse = valueAt(1);
        const pipelineResponse = valueAt(2);
        const buildResponse = valueAt(3);
        const imageResponse = valueAt(4);
        const runResponse = valueAt(5);
        const artifactResponse = valueAt(6);
        const repositoryResponse = valueAt(7);

        if (capabilityResponse?.result) setCapabilities(capabilityResponse.result);
        setCodeModules(unwrapList<CodeModule>(moduleResponse));
        setPipelines(unwrapList<Pipeline>(pipelineResponse).map(normalizePipeline));
        setBuilds(unwrapList<ImageBuild>(buildResponse));
        setImages(unwrapList<RegistryImage>(imageResponse).map(normalizeImage));
        setRuns(unwrapList<PipelineRun>(runResponse));
        setArtifacts(unwrapList<Artifact>(artifactResponse));
        setRepositories(unwrapList<RegistryRepository>(repositoryResponse));

        if (failures.length > 0) {
          setLoadError(`部分接口失败（${failures.length}/${results.length}），已展示可用数据`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法连接后端";
        setLoadError(message);
        toast({
          title: "平台状态读取失败",
          description: message,
          variant: "destructive",
        });
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasActiveJob = useMemo(
    () =>
      builds.some((build) => activeStatuses.has(build.status)) ||
      runs.some((run) => activeStatuses.has(run.status)),
    [builds, runs],
  );

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      loadData(true);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, loadData]);

  const handleBuild = async () => {
    if (!selectedModuleId || !targetImage.trim()) {
      toast({ title: "构建参数不完整", description: "请选择代码模块并填写目标镜像", variant: "destructive" });
      return;
    }
    setSubmittingBuild(true);
    try {
      await platformApi.createImageBuild({
        code_module_id: selectedModuleId,
        base_image: baseImage,
        target_image: targetImage.trim(),
        dockerfile,
      });
      toast({
        title: "镜像构建已提交",
        description:
          capabilities?.health?.cube_studio?.mode === "cube-studio"
            ? "已提交 Cube Studio，请继续在调试容器中保存镜像"
            : "本地兼容模式已登记构建任务",
      });
      await loadData(true);
    } catch (error) {
      toast({
        title: "提交构建失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setSubmittingBuild(false);
    }
  };

  const handleRun = async () => {
    if (!selectedPipelineId) {
      toast({ title: "运行参数不完整", description: "请选择 Pipeline", variant: "destructive" });
      return;
    }
    setSubmittingRun(true);
    try {
      const selectedPipeline = pipelines.find((item) => String(item.id) === selectedPipelineId);
      await platformApi.createPipelineRun({
        pipeline_id: selectedPipelineId,
        image_ids: selectedImageIds,
        parameters: { pipeline_name: selectedPipeline?.name },
      });
      toast({ title: "Pipeline 已提交" });
      await loadData(true);
    } catch (error) {
      toast({
        title: "启动 Pipeline 失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setSubmittingRun(false);
    }
  };

  const handleRepository = async () => {
    try {
      await platformApi.createRepository(repositoryForm);
      setRepositoryOpen(false);
      setRepositoryForm({ name: "", server: "", user: "", password: "", hubsecret: "" });
      toast({ title: "镜像仓库配置已保存" });
      await loadData(true);
    } catch (error) {
      toast({
        title: "仓库配置失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
    }
  };

  const cubeHealth = capabilities?.health?.cube_studio;
  const artifactHealth = capabilities?.health?.artifact_store;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              工作流首页
            </Button>
          </div>
          <div className="mb-2 flex items-center gap-2 text-sm text-primary">
            <CloudCog className="h-4 w-4" />
            Cube Studio / Registry / Pipeline / MinIO
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">镜像构建与 Pipeline</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            从代码资产锁定版本，构建算法镜像，按摘要登记到镜像库，再运行 Pipeline 并归档产物。
          </p>
        </div>
        <Button variant="outline" onClick={() => loadData()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新状态
        </Button>
      </div>

      {loadError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <p className="text-destructive">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => loadData()}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !capabilities && (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            正在读取 Cube Studio / MinIO 平台状态…
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { icon: GitBranch, title: "1. 代码版本", text: "仓库 + 分支/Commit" },
          { icon: Container, title: "2. 镜像构建", text: "Cube Docker Build" },
          { icon: Workflow, title: "3. Pipeline", text: "DAG / Argo Workflow" },
          { icon: Database, title: "4. 产物归档", text: "MinIO / S3 兼容存储" },
        ].map((step) => (
          <Card key={step.title}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <step.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.text}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.2fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerCog className="h-5 w-5" />
              Cube Studio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">运行模式</span>
              <Badge variant={cubeHealth?.reachable && cubeHealth?.configured ? "default" : "outline"}>
                {cubeHealth?.mode === "cube-studio" ? "真实服务" : "本地兼容"}
              </Badge>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {cubeHealth?.message || (loading ? "读取中..." : "暂无状态")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-5 w-5" />
              产物存储
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Provider</span>
              <Badge variant={artifactHealth?.provider === "minio" && artifactHealth?.reachable ? "default" : "outline"}>
                {artifactHealth?.provider || (loading ? "读取中" : "未知")}
              </Badge>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {artifactHealth?.message || (loading ? "读取中..." : "暂无状态")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Box className="h-5 w-5" />
              镜像仓库
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setRepositoryOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              配置
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {repositories.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">暂无仓库，可点击右上角配置</p>
            )}
            {repositories.slice(0, 3).map((repository) => (
              <div key={repository.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{repository.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{repository.server}</p>
                </div>
                <Badge variant="outline">{repository.provider}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PackagePlus className="h-5 w-5" />
              创建镜像构建
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>代码模块</Label>
                <Select value={selectedModuleId} onValueChange={setSelectedModuleId}>
                  <SelectTrigger>
                    <SelectValue placeholder={codeModules.length ? "选择代码资产" : "暂无代码资产"} />
                  </SelectTrigger>
                  <SelectContent>
                    {codeModules.map((module) => (
                      <SelectItem key={module.id} value={String(module.id)}>
                        {module.name} · {module.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Dockerfile</Label>
                <Input value={dockerfile} onChange={(event) => setDockerfile(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>基础镜像</Label>
                <Input value={baseImage} onChange={(event) => setBaseImage(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>目标镜像</Label>
                <Input
                  value={targetImage}
                  onChange={(event) => setTargetImage(event.target.value)}
                  placeholder="harbor.local/robot/algorithm:1.0.0"
                />
              </div>
            </div>
            <Button onClick={handleBuild} disabled={submittingBuild || codeModules.length === 0}>
              {submittingBuild ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Container className="mr-2 h-4 w-4" />}
              提交镜像构建
            </Button>
            <Separator />
            <div className="space-y-3">
              {builds.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">暂无构建任务</p>}
              {builds.slice(0, 4).map((build) => (
                <div key={build.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{build.code_module_name}</p>
                      <p className="break-all text-xs text-muted-foreground">{build.target_image}</p>
                    </div>
                    <Badge variant={statusVariant(build.status)}>{statusText[build.status] || build.status}</Badge>
                  </div>
                  <Progress value={Number(build.progress) || 0} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{build.phase}</span>
                    <span>{Number(build.progress) || 0}%</span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    manifest sha256:{(build.build_manifest?.sha256 || "pending").toString().slice(0, 16)}…
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Play className="h-5 w-5" />
              运行 Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
                <SelectTrigger>
                  <SelectValue placeholder={pipelines.length ? "选择任务工作流" : "暂无 Pipeline"} />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={String(pipeline.id)}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>按摘要锁定镜像（可选）</Label>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-2">
                {images.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    暂无镜像；Cube 模式可直接运行已绑定 DAG 的 Pipeline
                  </p>
                )}
                {images.map((image) => (
                  <label key={image.id} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50">
                    <Checkbox
                      checked={selectedImageIds.includes(String(image.id))}
                      onCheckedChange={(checked) =>
                        setSelectedImageIds((current) =>
                          checked
                            ? [...new Set([...current, String(image.id)])]
                            : current.filter((id) => id !== String(image.id)),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{image.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {image.digest || image.target_image || "无摘要"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={handleRun} disabled={submittingRun || pipelines.length === 0}>
              {submittingRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              启动 Pipeline
            </Button>
            <Separator />
            <div className="space-y-3">
              {runs.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">暂无 Pipeline 运行</p>}
              {runs.slice(0, 3).map((run) => (
                <div key={run.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{run.pipeline_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(run.submitted_at)} · {run.provider}
                      </p>
                    </div>
                    <Badge variant={statusVariant(run.status)}>{statusText[run.status] || run.status}</Badge>
                  </div>
                  <Progress value={Number(run.progress) || 0} className="h-2" />
                  <div className="grid gap-1 sm:grid-cols-2">
                    {(run.tasks || []).map((task) => (
                      <div key={task.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {task.status === "succeeded" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : task.status === "running" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                          <CircleDashed className="h-3.5 w-3.5" />
                        )}
                        {task.name}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Archive className="h-5 w-5" />
            镜像与运行产物
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 2xl:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-3 text-sm font-medium">镜像库</h3>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>镜像</TableHead>
                    <TableHead>摘要/证据</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {images.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        暂无镜像记录
                      </TableCell>
                    </TableRow>
                  )}
                  {images.map((image) => (
                    <TableRow key={image.id}>
                      <TableCell>
                        <p className="font-medium">{image.name}</p>
                        <p className="max-w-[260px] truncate text-xs text-muted-foreground">{image.target_image}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-[11px]">
                          {(image.digest || "无 digest").toString().slice(0, 24)}
                          {image.digest ? "…" : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {image.runtime_verified ? "运行时已验证" : "元数据联调证据"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(image.status)}>{statusText[image.status] || image.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="mb-3 text-sm font-medium">Pipeline 产物</h3>
            <div className="space-y-2">
              {artifacts.length === 0 && (
                <p className="rounded-md border py-8 text-center text-sm text-muted-foreground">
                  Pipeline 完成后产物会归档到这里
                </p>
              )}
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{artifact.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {artifact.storage?.provider} · {artifact.storage?.object_key} · {artifact.storage?.size ?? 0} B
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => platformApi.downloadArtifact(artifact.id, artifact.name)}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    下载
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={repositoryOpen} onOpenChange={setRepositoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置镜像仓库</DialogTitle>
            <DialogDescription>
              真实 Cube Studio 模式会创建 Repository 并同步 K8s hubsecret；本地模式仅保存脱敏配置。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>名称</Label>
              <Input
                value={repositoryForm.name}
                onChange={(event) => setRepositoryForm({ ...repositoryForm, name: event.target.value })}
                placeholder="robot-harbor"
              />
            </div>
            <div className="grid gap-2">
              <Label>仓库地址</Label>
              <Input
                value={repositoryForm.server}
                onChange={(event) => setRepositoryForm({ ...repositoryForm, server: event.target.value })}
                placeholder="harbor.example.com/robot/"
              />
            </div>
            <div className="grid gap-2">
              <Label>hubsecret</Label>
              <Input
                value={repositoryForm.hubsecret}
                onChange={(event) => setRepositoryForm({ ...repositoryForm, hubsecret: event.target.value })}
                placeholder="robot-registry"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>用户名</Label>
                <Input
                  value={repositoryForm.user}
                  onChange={(event) => setRepositoryForm({ ...repositoryForm, user: event.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>密码</Label>
                <Input
                  type="password"
                  value={repositoryForm.password}
                  onChange={(event) => setRepositoryForm({ ...repositoryForm, password: event.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleRepository}>保存仓库配置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
