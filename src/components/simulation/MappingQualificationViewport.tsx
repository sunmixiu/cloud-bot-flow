import { AlertTriangle, Box, CheckCircle2, Cpu, Database, FileCode2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MappingQualificationEvidence {
  kind?: string;
  publishable?: boolean;
  algorithm?: { name?: string; delivery_image?: string };
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
  assertions?: Record<string, boolean>;
  blockers?: string[];
  required_fix?: string[];
  integrity?: { verified?: boolean };
}

interface Props {
  status: string;
  algorithmName?: string;
  image?: string;
  evidence?: MappingQualificationEvidence;
}

const assertionLabels: Record<string, string> = {
  immutable_image_digest: "不可变镜像摘要",
  source_tree_present: "FAST-LIVO2 源码树",
  model_present: "YOLO-Pose 模型",
  runtime_arch_matches: "容器与二进制架构一致",
  ros2_runtime_available: "ROS 2 运行时",
  python_dependencies_available: "Python 运行依赖",
  replay_dataset_present: "可回放传感器数据",
  mapping_process_started: "建图进程可启动",
};

export default function MappingQualificationViewport({ status, algorithmName, image, evidence }: Props) {
  const completed = status === "completed";
  const publishable = evidence?.publishable === true;
  const assertions = Object.entries(evidence?.assertions || {});
  const blockers = evidence?.blockers || [];

  return (
    <section className="min-h-[520px] bg-[#07101c] p-5 text-slate-100" aria-label="建图镜像运行时验收视图">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <p className="text-sm font-semibold">{algorithmName || evidence?.algorithm?.name || "建图算法交付镜像"}</p>
          <p className="mt-1 text-xs text-slate-400">真实容器运行时验收 · 未产生地图时不渲染三维场景</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-cyan-500/40 text-cyan-200">OCI 摘要锁定</Badge>
          {completed ? (
            publishable ? (
              <Badge className="bg-emerald-500/15 text-emerald-300">允许发布</Badge>
            ) : (
              <Badge className="bg-amber-500/15 text-amber-200">上线阻断</Badge>
            )
          ) : (
            <Badge variant="secondary">等待验收</Badge>
          )}
        </div>
      </div>

      {!evidence ? (
        <div className="grid min-h-[400px] place-items-center text-center">
          <div className="max-w-xl">
            <Cpu className="mx-auto h-12 w-12 text-cyan-400" />
            <h3 className="mt-4 text-lg font-semibold">等待真实 Pipeline 检查交付镜像</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              平台将检查容器架构、FAST-LIVO2 二进制、ROS 2、Python 依赖、模型文件和回放数据。只有容器真正输出地图证据后，才会切换到三维点云或 Mesh 视图。
            </p>
            <p className="mt-3 break-all font-mono text-xs text-slate-500">{image}</p>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className={`rounded-xl border p-4 ${publishable ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
            <div className="flex items-start gap-3">
              {publishable ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" /> : <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-300" />}
              <div>
                <p className="font-semibold">{publishable ? "运行时验收通过" : "交付镜像已隔离，禁止作为建图算法上线"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  这是实际容器探针的结果。验收闭环已完成，但“验收完成”不等于“建图成功”。
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={Cpu} label="容器 / 二进制" value={`${evidence.runtime?.container_arch || "—"} / ${evidence.runtime?.payload_binary_arch || "—"}`} />
            <Metric icon={FileCode2} label="源码文件" value={String(evidence.delivery?.source_file_count ?? "—")} />
            <Metric icon={Box} label="模型大小" value={formatBytes(evidence.delivery?.model_bytes)} />
            <Metric icon={Database} label="回放数据集" value={String(evidence.delivery?.dataset_count ?? 0)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <h4 className="text-sm font-semibold">运行契约检查</h4>
              <div className="mt-3 space-y-2">
                {assertions.map(([key, passed]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2 text-xs">
                    <span className="text-slate-300">{assertionLabels[key] || key}</span>
                    <span className={`flex items-center gap-1 ${passed ? "text-emerald-300" : "text-red-300"}`}>
                      {passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {passed ? "通过" : "失败"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-slate-950/50 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-200"><AlertTriangle className="h-4 w-4" />上线阻断项</h4>
              <div className="mt-3 space-y-2">
                {blockers.length ? blockers.map((blocker) => (
                  <p key={blocker} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100">{blocker}</p>
                )) : <p className="text-xs text-emerald-300">没有运行时阻断项。</p>}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-slate-400">Python / ROS 2 / NumPy</span>
              <code>{evidence.runtime?.python_version || "—"} / {evidence.runtime?.ros2_available ? "available" : "missing"} / {evidence.runtime?.numpy_available ? "available" : "missing"}</code>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2">
              <span className="text-slate-400">证据完整性</span>
              <code className={evidence.integrity?.verified ? "text-emerald-300" : "text-red-300"}>{evidence.integrity?.verified ? "SHA-256 通过" : "未通过"}</code>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <Icon className="h-4 w-4 text-cyan-300" />
      <p className="mt-3 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function formatBytes(value?: number) {
  if (value == null) return "—";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
