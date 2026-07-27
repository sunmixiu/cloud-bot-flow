import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface GeneratedRobot {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
}

interface RobotParams {
  upperBody: {
    dof: string;
    payload: number;
    weight: number;
    workRadius: number;
  };
  lowerBody: {
    dof: string;
    payload: number;
    weight: number;
    speed: number;
  };
}

interface CombinedRobotPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  combinedRobot: GeneratedRobot | null;
  robotParams?: RobotParams;
  onSave?: () => void;
}

export function CombinedRobotPreviewDialog({
  open,
  onOpenChange,
  combinedRobot,
  robotParams,
  onSave
}: CombinedRobotPreviewDialogProps) {
  if (!combinedRobot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-2xl">组合预览</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-8 py-6">
          {/* 左侧：机器人图片 */}
          <div className="flex-shrink-0">
            <div className="w-80 h-80 rounded-lg overflow-hidden bg-muted shadow-lg">
              <img
                src={combinedRobot.imageUrl}
                alt={combinedRobot.name}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
          
          {/* 右侧：机器人信息和参数 */}
          <div className="flex-1 flex flex-col gap-6">
            <div>
              <h3 className="font-semibold text-2xl mb-2">{combinedRobot.name}</h3>
              <p className="text-muted-foreground">{combinedRobot.description}</p>
            </div>

            {robotParams && (
              <div className="flex-1 space-y-6">
                {/* 上半身参数 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-primary rounded-full" />
                    <h4 className="font-semibold text-lg">上半身参数</h4>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4 pl-3">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">自由度</p>
                      <p className="font-semibold text-lg">{robotParams.upperBody.dof}自由度</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">负载</p>
                      <p className="font-semibold text-lg">{robotParams.upperBody.payload}kg</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">重量</p>
                      <p className="font-semibold text-lg">{robotParams.upperBody.weight}kg</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">工作半径</p>
                      <p className="font-semibold text-lg">{robotParams.upperBody.workRadius}m</p>
                    </div>
                  </div>
                </div>

                {/* 下半身参数 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-primary rounded-full" />
                    <h4 className="font-semibold text-lg">下半身参数</h4>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4 pl-3">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">自由度</p>
                      <p className="font-semibold text-lg">{robotParams.lowerBody.dof}自由度</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">负载</p>
                      <p className="font-semibold text-lg">{robotParams.lowerBody.payload}kg</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">重量</p>
                      <p className="font-semibold text-lg">{robotParams.lowerBody.weight}kg</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">速度</p>
                      <p className="font-semibold text-lg">{robotParams.lowerBody.speed}m/s</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={onSave}
              className="w-full"
              size="lg"
            >
              保存到机器人列表
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
