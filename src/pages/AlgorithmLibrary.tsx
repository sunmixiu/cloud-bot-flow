import { useEffect, useMemo, useState } from "react";
import {
  Box,
  CheckCircle2,
  Clock3,
  Code2,
  Container,
  ExternalLink,
  GitBranch,
  PackageCheck,
  Plus,
  ShieldCheck,
  Upload,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { algorithmApi, codeRepositoryApi, simulationAlgorithmApi } from "@/services/api";

interface CodeModule {
  id: string | number;
  name: string;
  module: string;
  language: string;
  version: string;
  author: string;
  repository_url: string;
  branch: string;
  description: string;
  visibility: string;
  status: string;
  updated_at: string;
  license?: string;
  source?: string;
  verified_commit?: string;
}

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
  license?: string;
  repository_url?: string;
  image_status?: string;
  verified_commit?: string;
}

const initialForm = {
  name: "",
  module: "感知与定位",
  language: "Python / ROS 2",
  version: "0.1.0",
  author: "",
  repository_url: "",
  branch: "main",
  description: "",
  docker_image: "",
  command: "",
  runtime: "ROS 2 Humble",
};

const statusLabel: Record<string, string> = {
  verified: "已验证",
  testing: "测试中",
  developing: "开发中",
  ready: "可运行",
  "verified-source": "源码已验证",
};

export default function AlgorithmLibrary() {
  const [codeModules, setCodeModules] = useState<CodeModule[]>([]);
  const [simulationAlgorithms, setSimulationAlgorithms] = useState<SimulationAlgorithm[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const { toast } = useToast();

  const loadAssets = async () => {
    try {
      const [codeResponse, simulationResponse] = await Promise.all([
        codeRepositoryApi.getList(),
        simulationAlgorithmApi.getList(),
      ]);
      setCodeModules(codeResponse.result?.data || []);
      setSimulationAlgorithms(simulationResponse.result?.data || []);
    } catch (error) {
      console.error("Load algorithm assets failed:", error);
      toast({
        title: "加载失败",
        description: "无法读取算法资产库",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    loadAssets();
  }, []);

  const moduleCount = useMemo(
    () => new Set(codeModules.map((item) => item.module)).size,
    [codeModules],
  );

  const handleUpload = async () => {
    if (!form.name.trim() || !form.repository_url.trim()) {
      toast({
        title: "信息不完整",
        description: "请填写算法名称和私域仓库地址",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const codeResponse = await codeRepositoryApi.create({
        name: form.name,
        module: form.module,
        language: form.language,
        version: form.version,
        author: form.author || "当前用户",
        repository_url: form.repository_url,
        branch: form.branch,
        description: form.description,
        visibility: "private",
        status: form.docker_image ? "verified" : "testing",
      });

      if (form.docker_image.trim()) {
        await Promise.all([
          simulationAlgorithmApi.create({
            code_module_id: codeResponse.result.id,
            name: form.name,
            module: form.module,
            version: form.version,
            image: form.docker_image,
            command: form.command,
            runtime: form.runtime,
            inputs: [],
            outputs: [],
            description: form.description,
            status: "ready",
            color: "#3b82f6",
          }),
          algorithmApi.create({
            name: form.name,
            describe: form.description || `${form.module}仿真算法`,
            images_url: form.docker_image,
            entrypoint: form.command,
            gitpath: form.repository_url,
            version: form.version,
          }),
        ]);
      }

      await loadAssets();
      setUploadOpen(false);
      setForm(initialForm);
      toast({
        title: "算法已入库",
        description: form.docker_image
          ? "代码资产和 Docker 仿真镜像均已登记"
          : "代码资产已登记，构建镜像后可进入仿真库",
      });
    } catch (error) {
      console.error("Upload algorithm failed:", error);
      toast({
        title: "入库失败",
        description: "轻量后端未能保存算法资产",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheck className="h-4 w-4" />
            团队与开源算法资产
          </div>
          <h1 className="text-3xl font-bold">代码与仿真算法库</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            统一管理机器人算法源代码、版本、负责人和 Docker 运行镜像，为工作流编排提供经过验证的可执行资产。
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="bg-gradient-primary">
          <Upload className="mr-2 h-4 w-4" />
          上传算法
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <Code2 className="mb-3 h-5 w-5 text-primary" />
            <div className="text-2xl font-bold">{codeModules.length}</div>
            <p className="text-sm text-muted-foreground">代码资产</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <GitBranch className="mb-3 h-5 w-5 text-sky-400" />
            <div className="text-2xl font-bold">{moduleCount}</div>
            <p className="text-sm text-muted-foreground">算法模块</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Container className="mb-3 h-5 w-5 text-violet-400" />
            <div className="text-2xl font-bold">{simulationAlgorithms.length}</div>
            <p className="text-sm text-muted-foreground">仿真算法规格</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <PackageCheck className="mb-3 h-5 w-5 text-emerald-400" />
            <div className="text-2xl font-bold">
              {simulationAlgorithms.filter(
                (item) => item.status === "ready" || item.status === "verified-source",
              ).length}
            </div>
            <p className="text-sm text-muted-foreground">可数字孪生验证</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="code" className="space-y-5">
        <TabsList>
          <TabsTrigger value="code">
            <Code2 className="mr-2 h-4 w-4" />
            代码资产库
          </TabsTrigger>
          <TabsTrigger value="simulation">
            <Container className="mr-2 h-4 w-4" />
            仿真算法库
          </TabsTrigger>
        </TabsList>

        <TabsContent value="code">
          <div className="grid gap-4 lg:grid-cols-2">
            {codeModules.map((module) => (
              <Card key={module.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge variant="outline" className="mb-2">{module.module}</Badge>
                      <CardTitle className="text-lg">{module.name}</CardTitle>
                    </div>
                    <Badge variant={module.status === "verified" ? "default" : "secondary"}>
                      {statusLabel[module.status] || module.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="min-h-10 text-sm text-muted-foreground">{module.description}</p>
                  <a
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 font-mono text-xs hover:border-primary/50"
                    href={module.repository_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="truncate">{module.repository_url}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      {module.branch} · {module.version}
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {module.author}
                    </div>
                    <div className="flex items-center gap-2">
                      <Code2 className="h-4 w-4 text-muted-foreground" />
                      {module.language}
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-muted-foreground" />
                      {new Date(module.updated_at).toLocaleDateString("zh-CN")}
                    </div>
                  </div>
                  {(module.source === "github" || module.license) && (
                    <div className="flex flex-wrap gap-2">
                      {module.source === "github" && <Badge variant="secondary">GitHub 上游</Badge>}
                      {module.license && <Badge variant="outline">{module.license}</Badge>}
                      {module.verified_commit && (
                        <Badge variant="outline" className="font-mono">
                          {module.verified_commit.slice(0, 7)}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="simulation">
          <div className="grid gap-4 xl:grid-cols-2">
            {simulationAlgorithms.map((algorithm) => (
              <Card key={algorithm.id}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${algorithm.color}22`, color: algorithm.color }}
                    >
                      <Box className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{algorithm.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {algorithm.module} · {algorithm.version}
                          </p>
                        </div>
                        <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          {algorithm.status === "verified-source" ? "源码已验证" : "本地可运行"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{algorithm.description}</p>
                      <div className="mt-3 rounded-lg border bg-background/60 p-3 font-mono text-xs">
                        {algorithm.image}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">{algorithm.runtime}</Badge>
                        {algorithm.image_status === "build-required" && (
                          <Badge className="bg-amber-500/15 text-amber-400 hover:bg-amber-500/15">
                            待 CI 构建镜像
                          </Badge>
                        )}
                        {algorithm.license && <Badge variant="outline">{algorithm.license}</Badge>}
                        {algorithm.inputs.map((topic) => (
                          <Badge key={topic} variant="secondary">IN {topic}</Badge>
                        ))}
                        {algorithm.outputs.map((topic) => (
                          <Badge key={topic} variant="secondary">OUT {topic}</Badge>
                        ))}
                      </div>
                      {algorithm.repository_url && (
                        <a
                          href={algorithm.repository_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          查看 GitHub 上游
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>上传团队算法</DialogTitle>
            <DialogDescription>
              第一版登记私域 Git 地址和可选 Docker 镜像；后续可接入 GitLab、Harbor 与 CI 自动构建。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label>算法名称</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="例如：视觉伺服控制"
              />
            </div>
            <div className="space-y-2">
              <Label>所属模块</Label>
              <Select
                value={form.module}
                onValueChange={(value) => setForm((prev) => ({ ...prev, module: value }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="感知与定位">感知与定位</SelectItem>
                  <SelectItem value="机器视觉">机器视觉</SelectItem>
                  <SelectItem value="运动规划与控制">运动规划与控制</SelectItem>
                  <SelectItem value="任务规划">任务规划</SelectItem>
                  <SelectItem value="人机交互">人机交互</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>语言与框架</Label>
              <Input
                value={form.language}
                onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>版本</Label>
              <Input
                value={form.version}
                onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>负责人</Label>
              <Input
                value={form.author}
                onChange={(event) => setForm((prev) => ({ ...prev, author: event.target.value }))}
                placeholder="团队成员姓名"
              />
            </div>
            <div className="space-y-2">
              <Label>分支</Label>
              <Input
                value={form.branch}
                onChange={(event) => setForm((prev) => ({ ...prev, branch: event.target.value }))}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>私域 Git 仓库地址</Label>
              <Input
                value={form.repository_url}
                onChange={(event) => setForm((prev) => ({ ...prev, repository_url: event.target.value }))}
                placeholder="ssh://git.local/robot/my-algorithm.git"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>算法说明</Label>
              <Textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="输入输出、依赖、适用机器人和测试情况"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Docker 镜像（可选）</Label>
              <Input
                value={form.docker_image}
                onChange={(event) => setForm((prev) => ({ ...prev, docker_image: event.target.value }))}
                placeholder="harbor.local/robot/my-algorithm:0.1.0"
              />
            </div>
            {form.docker_image && (
              <>
                <div className="space-y-2">
                  <Label>启动命令</Label>
                  <Input
                    value={form.command}
                    onChange={(event) => setForm((prev) => ({ ...prev, command: event.target.value }))}
                    placeholder="ros2 launch ..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>运行时</Label>
                  <Input
                    value={form.runtime}
                    onChange={(event) => setForm((prev) => ({ ...prev, runtime: event.target.value }))}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>取消</Button>
            <Button onClick={handleUpload} disabled={isSaving}>
              <Plus className="mr-2 h-4 w-4" />
              {isSaving ? "保存中..." : "入库"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
