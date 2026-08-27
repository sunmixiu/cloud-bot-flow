import { useMemo, useState, type PointerEvent } from "react";
import { AlertTriangle, Camera, CheckCircle2, Image as ImageIcon, RefreshCw, ScanSearch, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ViewMode = "split" | "compare" | "zoom";

interface VisualEvidence {
  kind?: string;
  artifact_key?: string;
  algorithm?: { name?: string; source?: string };
  metrics?: {
    width_px?: number;
    height_px?: number;
    edge_mean?: number;
    radius?: number;
  };
  integrity?: { verified?: boolean };
  assets?: Array<{ name?: string; path?: string; type?: string }>;
}

interface VisualEvidenceViewportProps {
  status: string;
  algorithmName?: string;
  evidence?: VisualEvidence;
  inputUrl?: string;
  outputUrl?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

const modeLabels: Array<{ id: ViewMode; label: string; icon: typeof ImageIcon }> = [
  { id: "split", label: "原图 / 结果", icon: ImageIcon },
  { id: "compare", label: "滑动对比", icon: SlidersHorizontal },
  { id: "zoom", label: "局部放大", icon: ScanSearch },
];

export default function VisualEvidenceViewport({
  status,
  algorithmName,
  evidence,
  inputUrl,
  outputUrl,
  loading,
  error,
  onRetry,
}: VisualEvidenceViewportProps) {
  const [mode, setMode] = useState<ViewMode>("split");
  const [comparePosition, setComparePosition] = useState(50);
  const [zoomSource, setZoomSource] = useState<"input" | "output">("output");
  const [focus, setFocus] = useState({ x: 50, y: 50 });

  const hasInput = Boolean(inputUrl);
  const hasOutput = Boolean(outputUrl);
  const hasBothImages = hasInput && hasOutput;
  const hasAnyImage = hasInput || hasOutput;
  const isSyntheticInput = useMemo(
    () => evidence?.assets?.some((asset) => /synthetic|generated|生成|测试输入/i.test(asset.name || "")) ?? false,
    [evidence?.assets],
  );
  const inputSourceLabel = isSyntheticInput ? "Workflow 生成测试输入" : "运行时图像证据";
  const isFinished = ["completed", "failed", "canceled", "interrupted"].includes(status);
  const zoomUrl = (zoomSource === "input" ? inputUrl : outputUrl) || inputUrl || outputUrl;

  const updateFocus = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100));
    setFocus({ x, y });
  };

  return (
    <section className="min-h-[520px] bg-[#07101c] text-slate-100" aria-label="二维视觉算法证据视图">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/50 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-300">
            <Camera className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{algorithmName || evidence?.algorithm?.name || "二维视觉算法"}</p>
            <p className="text-[11px] text-slate-400">容器证据视图 · 不渲染无关三维占位场景</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={isSyntheticInput ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"} variant="outline">
            {inputSourceLabel}
          </Badge>
          <Badge className={evidence?.integrity?.verified ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300"} variant="outline">
            {evidence?.integrity?.verified ? "SHA-256 已验证" : "等待完整性证据"}
          </Badge>
        </div>
      </div>

      {hasAnyImage ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-950/70 p-1">
              {modeLabels.filter(({ id }) => hasBothImages || id === "split").map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  aria-pressed={mode === id}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition ${mode === id ? "bg-cyan-500/15 text-cyan-200" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
                >
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
            <p className="font-mono text-[11px] text-slate-400">
              {evidence?.metrics?.width_px ?? "—"} × {evidence?.metrics?.height_px ?? "—"} px
            </p>
          </div>

          <div className="p-5">
            {mode === "split" && (
              <div className="grid gap-4 lg:grid-cols-2">
                {inputUrl ? <EvidenceFigure url={inputUrl} label="原始输入" detail={inputSourceLabel} /> : <MissingFigure label="原始输入未归档" />}
                {outputUrl ? <EvidenceFigure url={outputUrl} label="算法结果" detail="真实容器输出" /> : <MissingFigure label="本次算法未归档可视化结果图" />}
              </div>
            )}

            {mode === "compare" && hasBothImages && (
              <div className="mx-auto max-w-4xl">
                <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-black shadow-2xl">
                  <img src={inputUrl} alt="边缘检测原始输入" className="absolute inset-0 h-full w-full object-contain" />
                  <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                    <img src={outputUrl} alt="边缘检测算法输出" className="h-full w-full object-contain" />
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.9)]" style={{ left: `${comparePosition}%` }} />
                  <span className="absolute left-3 top-3 rounded bg-slate-950/80 px-2 py-1 text-[10px]">算法结果</span>
                  <span className="absolute right-3 top-3 rounded bg-slate-950/80 px-2 py-1 text-[10px]">原始输入</span>
                </div>
                <label className="mt-4 flex items-center gap-3 text-xs text-slate-400">
                  结果覆盖范围
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={comparePosition}
                    onChange={(event) => setComparePosition(Number(event.target.value))}
                    className="h-1.5 flex-1 cursor-ew-resize accent-cyan-400"
                    aria-label="调整输入与算法结果的对比位置"
                  />
                  <code className="w-10 text-right text-cyan-200">{comparePosition}%</code>
                </label>
              </div>
            )}

            {mode === "zoom" && hasBothImages && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 flex gap-2">
                    <Button size="sm" variant={zoomSource === "input" ? "default" : "outline"} onClick={() => setZoomSource("input")}>查看原图</Button>
                    <Button size="sm" variant={zoomSource === "output" ? "default" : "outline"} onClick={() => setZoomSource("output")}>查看结果</Button>
                  </div>
                  <div className="relative aspect-video cursor-crosshair overflow-hidden rounded-xl border border-slate-700 bg-black" onPointerMove={updateFocus}>
                    <img src={zoomUrl} alt="可选择局部的视觉证据" className="h-full w-full object-contain" />
                    <span className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300 shadow-[0_0_10px_rgba(103,232,249,.8)]" style={{ left: `${focus.x}%`, top: `${focus.y}%` }} />
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs text-slate-400">3× 局部放大 · 在左图移动鼠标选择区域</p>
                  <div
                    className="aspect-video rounded-xl border border-cyan-500/30 bg-black bg-no-repeat shadow-inner"
                    style={{ backgroundImage: `url(${zoomUrl})`, backgroundSize: "300% 300%", backgroundPosition: `${focus.x}% ${focus.y}%` }}
                    role="img"
                    aria-label="视觉证据局部放大结果"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-px border-t border-slate-800 bg-slate-800 sm:grid-cols-4">
            <Metric label="输入来源" value={isSyntheticInput ? "测试图" : "运行帧"} />
            <Metric label="边缘均值" value={evidence?.metrics?.edge_mean != null ? evidence.metrics.edge_mean.toFixed(4) : "—"} />
            <Metric label="检测半径" value={evidence?.metrics?.radius != null ? String(evidence.metrics.radius) : "—"} />
            <Metric label="证据归档" value={evidence?.artifact_key ? "MinIO" : "等待中"} />
          </div>
        </>
      ) : (
        <div className="grid min-h-[450px] place-items-center px-6 py-12">
          <div className="max-w-xl text-center">
            <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl border ${error ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"}`}>
              {error ? <AlertTriangle className="h-6 w-6" /> : loading || !isFinished ? <RefreshCw className="h-6 w-6 animate-spin" /> : <ImageIcon className="h-6 w-6" />}
            </div>
            <h3 className="mt-4 text-base font-semibold">
              {error ? "运行证据图片加载失败" : loading ? "正在读取容器图像证据" : !isFinished ? "等待真实 Pipeline 返回图像证据" : "本次运行没有可展示的图像证据"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {error || (isFinished
                ? "平台不会用默认货架或动画替代缺失的输入、输出。请检查 Workflow 是否归档原图、结果图以及对应的 Evidence Schema。"
                : "任务提交后，此区域将显示容器归档的原始输入和算法输出；在证据返回前不会生成模拟结果。")}
            </p>
            {error && onRetry && (
              <Button className="mt-5" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />重新加载证据</Button>
            )}
          </div>
        </div>
      )}

      {isSyntheticInput && (
        <div className="flex items-start gap-2 border-t border-amber-500/20 bg-amber-500/5 px-5 py-3 text-xs leading-5 text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          当前输入由 Workflow 在容器内生成，只能证明镜像、算法和证据链路可运行；它不代表真实相机接入。上线前应将输入替换为仿真器或设备发布的 /camera/image，并保留时间戳与帧来源。
        </div>
      )}
    </section>
  );
}

function EvidenceFigure({ url, label, detail }: { url: string; label: string; detail: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-700 bg-black shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-3 py-2 text-xs">
        <span className="font-medium text-slate-200">{label}</span>
        <span className="text-slate-500">{detail}</span>
      </div>
      <img src={url} alt={`${label}图像证据`} className="aspect-video w-full object-contain" />
    </figure>
  );
}

function MissingFigure({ label }: { label: string }) {
  return (
    <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 px-6 text-center">
      <div>
        <AlertTriangle className="mx-auto h-5 w-5 text-amber-300" />
        <p className="mt-2 text-sm font-medium text-amber-100">{label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">请在算法交付描述的 visual_assets.output 中声明产物路径；平台不会复制输入图冒充算法输出。</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-950/80 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
        {value === "MinIO" || value === "运行帧" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : null}
        {value}
      </div>
    </div>
  );
}
