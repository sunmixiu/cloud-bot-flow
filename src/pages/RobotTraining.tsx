import { Card, CardContent } from "@/components/ui/card";
import { API_CONFIG } from "@/services/api";

export default function RobotTraining() {
  return (
    <Card className="w-full h-full">
      <CardContent className="h-full p-0">
        <iframe
          src={API_CONFIG.trainingUrl}
          className="w-full h-full border-0"
          title="机器人训练场"
        />
      </CardContent>
    </Card>
  );
}
