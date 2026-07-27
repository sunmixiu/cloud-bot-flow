import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditResourceDialog, Resource } from "./EditResourceDialog";

interface AddResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (resourceType: "robots" | "tasks" | "algorithms" | "datasets", resource: Resource) => void;
}

export function AddResourceDialog({ open, onOpenChange, onAdd }: AddResourceDialogProps) {
  const [selectedType, setSelectedType] = useState<"robots" | "tasks" | "algorithms" | "datasets" | "">("");
  const [showEditDialog, setShowEditDialog] = useState(false);

  const handleNext = () => {
    if (selectedType) {
      setShowEditDialog(true);
    }
  };

  const handleSaveResource = (resource: Resource) => {
    if (selectedType) {
      // Generate new ID
      const newResource = {
        ...resource,
        id: `${selectedType.slice(0, -1)}-${Date.now()}`
      };
      onAdd(selectedType, newResource);
      setShowEditDialog(false);
      onOpenChange(false);
      setSelectedType("");
    }
  };

  const handleClose = () => {
    setShowEditDialog(false);
    onOpenChange(false);
    setSelectedType("");
  };

  return (
    <>
      <Dialog open={open && !showEditDialog} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加资源</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resourceType">选择资源类型</Label>
              <Select value={selectedType} onValueChange={(value: "robots" | "tasks" | "algorithms" | "datasets") => setSelectedType(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择要添加的资源类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="robots">机器人</SelectItem>
                  <SelectItem value="tasks">任务</SelectItem>
                  <SelectItem value="algorithms">算法</SelectItem>
                  <SelectItem value="datasets">数据</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              取消
            </Button>
            <Button onClick={handleNext} disabled={!selectedType}>
              下一步
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditResourceDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        resource={null}
        resourceType={selectedType as "robots" | "tasks" | "algorithms" | "datasets"}
        onSave={handleSaveResource}
      />
    </>
  );
}