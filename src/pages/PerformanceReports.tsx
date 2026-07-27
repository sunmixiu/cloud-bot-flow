import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  BarChart3, 
  TrendingUp, 
  Clock, 
  Target,
  Download,
  Calendar,
  CheckCircle,
  AlertCircle
} from "lucide-react";

// Mock performance data
const performanceMetrics = {
  taskAccuracy: 96.8,
  avgExecutionTime: 145, // seconds
  successRate: 94.2,
  efficiency: 89.5
};

const monthlyData = [
  { month: "1月", accuracy: 94.2, efficiency: 87.3, tasks: 156 },
  { month: "2月", accuracy: 95.1, efficiency: 88.7, tasks: 142 },
  { month: "3月", accuracy: 96.8, efficiency: 89.5, tasks: 168 },
  { month: "4月", accuracy: 97.2, efficiency: 91.2, tasks: 174 }
];

const robotPerformance = [
  { 
    id: "robot-1", 
    name: "搬运机器人-001", 
    accuracy: 97.5, 
    efficiency: 92.3, 
    uptime: 98.2,
    tasksCompleted: 45,
    avgTime: 132
  },
  { 
    id: "robot-2", 
    name: "检测机器人-002", 
    accuracy: 95.8, 
    efficiency: 88.7, 
    uptime: 96.5,
    tasksCompleted: 38,
    avgTime: 156
  },
  { 
    id: "robot-3", 
    name: "装配机器人-003", 
    accuracy: 98.1, 
    efficiency: 94.1, 
    uptime: 99.1,
    tasksCompleted: 42,
    avgTime: 148
  }
];

const recentTasks = [
  { id: 1, name: "物料搬运A→B", accuracy: 98.5, duration: 128, status: "completed" },
  { id: 2, name: "质量检测批次001", accuracy: 95.2, duration: 167, status: "completed" },
  { id: 3, name: "精密装配流程", accuracy: 97.8, duration: 156, status: "completed" },
  { id: 4, name: "设备维护检查", accuracy: 89.3, duration: 245, status: "error" }
];

const getAccuracyColor = (accuracy: number) => {
  if (accuracy >= 95) return "text-success";
  if (accuracy >= 90) return "text-warning";
  return "text-destructive";
};

const getEfficiencyBadge = (efficiency: number) => {
  if (efficiency >= 90) return "bg-success text-success-foreground";
  if (efficiency >= 80) return "bg-warning text-warning-foreground";
  return "bg-destructive text-destructive-foreground";
};

export default function PerformanceReports() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">性能报告</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Calendar className="h-4 w-4 mr-2" />
            时间范围
          </Button>
          <Button className="bg-gradient-primary">
            <Download className="h-4 w-4 mr-2" />
            导出报告
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shadow-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-success/10">
                <Target className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-success">
                  {performanceMetrics.taskAccuracy}%
                </p>
                <p className="text-sm text-muted-foreground">任务执行精度</p>
                <p className="text-xs text-success mt-1">↗ +2.4% 较上月</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{performanceMetrics.avgExecutionTime}s</p>
                <p className="text-sm text-muted-foreground">平均执行时间</p>
                <p className="text-xs text-success mt-1">↘ -8s 较上月</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-success/10">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-success">
                  {performanceMetrics.successRate}%
                </p>
                <p className="text-sm text-muted-foreground">成功率</p>
                <p className="text-xs text-success mt-1">↗ +1.8% 较上月</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{performanceMetrics.efficiency}%</p>
                <p className="text-sm text-muted-foreground">系统效率</p>
                <p className="text-xs text-success mt-1">↗ +3.2% 较上月</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              月度趋势分析
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {monthlyData.map((data, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{data.month}</span>
                    <div className="flex gap-4 text-sm">
                      <span className={getAccuracyColor(data.accuracy)}>
                        精度: {data.accuracy}%
                      </span>
                      <span>效率: {data.efficiency}%</span>
                      <span className="text-muted-foreground">
                        任务: {data.tasks}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div 
                        className="bg-gradient-primary h-2 rounded-full"
                        style={{ width: `${data.accuracy}%` }}
                      />
                    </div>
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div 
                        className="bg-success h-2 rounded-full"
                        style={{ width: `${data.efficiency}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Robot Performance */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              机器人性能对比
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {robotPerformance.map((robot) => (
                <div key={robot.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{robot.name}</p>
                      <p className="text-sm text-muted-foreground">
                        已完成 {robot.tasksCompleted} 个任务
                      </p>
                    </div>
                    <Badge className={getEfficiencyBadge(robot.efficiency)}>
                      效率 {robot.efficiency}%
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="text-center">
                      <p className={`font-bold ${getAccuracyColor(robot.accuracy)}`}>
                        {robot.accuracy}%
                      </p>
                      <p className="text-xs text-muted-foreground">精度</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{robot.uptime}%</p>
                      <p className="text-xs text-muted-foreground">在线率</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{robot.avgTime}s</p>
                      <p className="text-xs text-muted-foreground">平均用时</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Task Performance */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            最近任务执行情况
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-primary/10">
                    {task.status === "completed" ? (
                      <CheckCircle className="h-5 w-5 text-success" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{task.name}</p>
                    <p className="text-sm text-muted-foreground">
                      执行时长: {task.duration}秒
                    </p>
                  </div>
                </div>
                
                <div className="text-right">
                  <p className={`font-bold ${getAccuracyColor(task.accuracy)}`}>
                    精度: {task.accuracy}%
                  </p>
                  <Badge 
                    variant={task.status === "completed" ? "default" : "destructive"}
                    className="mt-1"
                  >
                    {task.status === "completed" ? "成功" : "失败"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}