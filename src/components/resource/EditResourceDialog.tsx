import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface Resource {
  id: string;
  name: string;
  [key: string]: any;
}

interface EditResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource | null;
  resourceType: "robots" | "tasks" | "algorithms" | "datasets";
  onSave: (resource: Resource) => void;
}

export function EditResourceDialog({ 
  open, 
  onOpenChange, 
  resource, 
  resourceType, 
  onSave 
}: EditResourceDialogProps) {
  const [formData, setFormData] = useState<Resource>({ id: "", name: "" });

  useEffect(() => {
    if (resource) {
      setFormData(resource);
    }
  }, [resource]);

  const handleSave = () => {
    onSave(formData);
    onOpenChange(false);
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const renderFormFields = () => {
    switch (resourceType) {
      case "robots":
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={formData.name || ""}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">型号</Label>
                <Input
                  id="model"
                  value={formData.model || ""}
                  onChange={(e) => handleInputChange("model", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="chassisType">底盘类型</Label>
                <Select value={formData.chassisType || ""} onValueChange={(value) => handleInputChange("chassisType", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择底盘类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="轮式底盘">轮式底盘</SelectItem>
                    <SelectItem value="履带底盘">履带底盘</SelectItem>
                    <SelectItem value="固定底座">固定底座</SelectItem>
                    <SelectItem value="腿式底盘">腿式底盘</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endEffectorType">末端执行器类型</Label>
                <Select value={formData.endEffectorType || ""} onValueChange={(value) => handleInputChange("endEffectorType", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择执行器类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="夹爪">夹爪</SelectItem>
                    <SelectItem value="吸盘">吸盘</SelectItem>
                    <SelectItem value="视觉传感器">视觉传感器</SelectItem>
                    <SelectItem value="精密夹具">精密夹具</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="workRange">工作范围</Label>
                <Input
                  id="workRange"
                  value={formData.workRange || ""}
                  onChange={(e) => handleInputChange("workRange", e.target.value)}
                  placeholder="如: 5mx5m"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weight">自重</Label>
                <Input
                  id="weight"
                  value={formData.weight || ""}
                  onChange={(e) => handleInputChange("weight", e.target.value)}
                  placeholder="如: 120kg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payload">负载</Label>
                <Input
                  id="payload"
                  value={formData.payload || ""}
                  onChange={(e) => handleInputChange("payload", e.target.value)}
                  placeholder="如: 50kg"
                />
              </div>
            </div>
          </>
        );

      case "tasks":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="pipeline_url">任务流链接</Label>
              <Input
                id="pipeline_url"
                value={formData.pipeline_url || ""}
                onChange={(e) => handleInputChange("pipeline_url", e.target.value)}
                placeholder="HTML格式的任务流链接"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="creator">创建者</Label>
              <Input
                id="creator"
                value={formData.creator || ""}
                onChange={(e) => handleInputChange("creator", e.target.value)}
                placeholder="创建者"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modified">修改时间</Label>
              <Input
                id="modified"
                value={formData.modified || ""}
                onChange={(e) => handleInputChange("modified", e.target.value)}
                placeholder="如: a day ago"
              />
            </div>
            {formData.project && (
              <div className="space-y-2">
                <Label>项目信息</Label>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm">
                    <div className="font-medium">{formData.project.name}</div>
                    <div className="text-muted-foreground">{formData.project.describe}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      类型: {formData.project.type} | ID: {formData.project.id}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        );

      case "algorithms":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="images_url">镜像地址</Label>
              <Input
                id="images_url"
                value={formData.images_url || ""}
                onChange={(e) => handleInputChange("images_url", e.target.value)}
                placeholder="如: ccr.ccs.tencentyun.com/cube-studio/python:strong"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="creator">创建者</Label>
              <Input
                id="creator"
                value={formData.creator || ""}
                onChange={(e) => handleInputChange("creator", e.target.value)}
                placeholder="创建者"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modified">修改时间</Label>
              <Input
                id="modified"
                value={formData.modified || ""}
                onChange={(e) => handleInputChange("modified", e.target.value)}
                placeholder="如: a day ago"
              />
            </div>
            {formData.project && (
              <div className="space-y-2">
                <Label>项目信息</Label>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm">
                    <div className="font-medium">{formData.project.name}</div>
                    <div className="text-muted-foreground">{formData.project.describe}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      类型: {formData.project.type}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        );

      case "datasets":
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={formData.name || ""}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="数据集英文名"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="version">版本</Label>
                <Input
                  id="version"
                  value={formData.version || ""}
                  onChange={(e) => handleInputChange("version", e.target.value)}
                  placeholder="如: 2024"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="label_html">中文名</Label>
              <Input
                id="label_html"
                value={formData.label_html || ""}
                onChange={(e) => handleInputChange("label_html", e.target.value)}
                placeholder="数据集中文名"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="describe">描述</Label>
              <Textarea
                id="describe"
                value={formData.describe || ""}
                onChange={(e) => handleInputChange("describe", e.target.value)}
                rows={3}
                placeholder="数据集描述"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner">责任人</Label>
              <Input
                id="owner"
                value={formData.owner || ""}
                onChange={(e) => handleInputChange("owner", e.target.value)}
                placeholder="如: admin,*"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="path_html">容器内路径</Label>
              <Textarea
                id="path_html"
                value={formData.path_html || ""}
                onChange={(e) => handleInputChange("path_html", e.target.value)}
                rows={2}
                placeholder="HTML格式的路径信息"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download_url_html">下载地址</Label>
              <Textarea
                id="download_url_html"
                value={formData.download_url_html || ""}
                onChange={(e) => handleInputChange("download_url_html", e.target.value)}
                rows={2}
                placeholder="HTML格式的下载地址"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {resource ? "编辑资源" : "添加资源"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {renderFormFields()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}