import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { algorithmApi, pipelineApi, resourceApi, API_CONFIG } from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIDesignDialog, type RobotConfig } from "./AIDesignDialog";
import { 
  Bot, 
  Cpu, 
  Brain,
  Target,
  Gamepad2,
  ListTodo, 
  Play, 
  RotateCcw,
  Plus,
  Settings,
  X,
  HelpCircle,
  ChevronRight
} from "lucide-react";

interface WorkflowNode {
  id: string;
  type: "task" | "robot" | "algorithm";
  name: string;
  serviceName?: string; // 用于存储算法的真实name，部署时使用
  assetId?: string | number;
  x: number;
  y: number;
}

interface Connection {
  id: string;
  fromId: string;
  toId: string;
}

interface ComponentType {
  type: "task" | "robot" | "algorithm";
  name: string;
  icon: any;
  category: string;
}

const getNodeIcon = (type: string) => {
  switch (type) {
    case "task": return ListTodo;
    case "robot": return Bot;
    case "algorithm": return Cpu;
    default: return ListTodo;
  }
};

const canConnect = (fromType: string, toType: string) => {
  // 单向连接规则：任务 -> 机器人 -> 算法，算法 -> 算法
  if (fromType === "task" && toType === "robot") return true;
  if (fromType === "robot" && toType === "algorithm") return true;
  if (fromType === "algorithm" && toType === "algorithm") return true;
  return false;
};

export function WorkflowCanvas() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [componentTypes, setComponentTypes] = useState<ComponentType[]>([]);
  const [draggedComponentType, setDraggedComponentType] = useState<string | null>(null);
  const [draggedComponentName, setDraggedComponentName] = useState<string | null>(null);
  const [draggedServiceName, setDraggedServiceName] = useState<string | null>(null);
  const [draggedAssetId, setDraggedAssetId] = useState<string | number | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [isDraggingConnection, setIsDraggingConnection] = useState(false);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectionDragPos, setConnectionDragPos] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const [tasks, setTasks] = useState<any[]>([]);
  const [robots, setRobots] = useState<any[]>([]);
  const [algorithms, setAlgorithms] = useState<any[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tasks: true,
    robots: true,
    algorithms: true
  });
  const [openAlgoProjects, setOpenAlgoProjects] = useState<Record<string, boolean>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState({ current: 0, total: 0, currentAlgo: "" });
  const [aiDesignDialogOpen, setAiDesignDialogOpen] = useState(false);
  const [selectedAIDesignNode, setSelectedAIDesignNode] = useState<string | null>(null);
  const [brainAssemblyDialogOpen, setBrainAssemblyDialogOpen] = useState(false);

  // Load components from API
  useEffect(() => {
    const loadComponents = async () => {
      try {
        const [tasksResponse, robotsData, algorithmsResponse] = await Promise.all([
          pipelineApi.getList(),
          resourceApi.getRobots(),
          algorithmApi.getList()
        ]);

        // API返回的数据结构是 { result: { data: [...] } }
        const tasksData = (tasksResponse as any).result?.data || [];
        const algorithmsList = (algorithmsResponse as any).result?.data || [];

        // 遍历每个算法ID获取详细信息
        const detailedAlgorithms = await Promise.all(
          algorithmsList.map(async (algo: any) => {
            try {
              const detailResponse = await algorithmApi.getById(algo.id);
              const detail = (detailResponse as any).result;
              return {
                id: detail.id,
                name: detail.name,
                describe: detail.describe,
                created_on: detail.created_on,
                changed_on: detail.changed_on,
                entrypoint: detail.entrypoint,
                dockerfile: detail.dockerfile,
                gitpath: detail.gitpath,
                project: detail.project
              };
            } catch (error) {
              console.error(`Failed to load algorithm ${algo.id}:`, error);
              return null;
            }
          })
        );

        // 过滤掉加载失败的算法
        const validAlgorithms = detailedAlgorithms.filter(algo => algo !== null);

        setTasks(tasksData);
        setRobots(robotsData);
        setAlgorithms(validAlgorithms);

        const components: ComponentType[] = [
          ...tasksData.map((task: any) => ({
            type: "task" as const,
            name: task.name,
            icon: ListTodo,
            category: "任务"
          })),
          ...robotsData.map((robot: any) => ({
            type: "robot" as const,
            name: robot.name,
            icon: Bot,
            category: "机器人"
          })),
          ...validAlgorithms.map((algo: any) => ({
            type: "algorithm" as const,
            name: algo.name,
            icon: algo.name === 'AI-Design' ? Brain : Cpu,
            project: algo.project?.name || "未分类",
            category: "算法"
          }))
        ];

        setComponentTypes(components);
      } catch (error) {
        console.error('Failed to load components:', error);
        toast("加载组件失败");
      }
    };

    loadComponents();
  }, []);

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleAlgoProject = (projectId: string) => {
    setOpenAlgoProjects(prev => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  // Group algorithms by project
  const algorithmsByProject = algorithms.reduce((acc, algo) => {
    const projectId = algo.project?.id || 'unknown';
    if (!acc[projectId]) {
      acc[projectId] = {
        projectName: algo.project?.name || '未分类',
        algorithms: []
      };
    }
    acc[projectId].algorithms.push(algo);
    return acc;
  }, {} as Record<string, { projectName: string; algorithms: any[] }>);

  const handleComponentDragStart = useCallback((
    e: React.DragEvent,
    type: string,
    name: string,
    serviceName?: string,
    assetId?: string | number,
  ) => {
    setDraggedComponentType(type);
    setDraggedComponentName(name);
    setDraggedServiceName(serviceName || null);
    setDraggedAssetId(assetId ?? null);
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedComponentType || !draggedComponentName || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 100; // offset to center the node
    const y = e.clientY - rect.top - 50;

    const newNode: WorkflowNode = {
      id: `${draggedComponentType}-${Date.now()}`,
      type: draggedComponentType as WorkflowNode['type'],
      name: draggedComponentName,
      ...(draggedServiceName && { serviceName: draggedServiceName }),
      ...(draggedAssetId !== null && { assetId: draggedAssetId }),
      x: Math.max(0, x),
      y: Math.max(0, y),
    };

    setNodes(prev => [...prev, newNode]);
    setDraggedComponentType(null);
    setDraggedComponentName(null);
    setDraggedServiceName(null);
    setDraggedAssetId(null);
    toast("节点已添加到画布");
  }, [draggedComponentType, draggedComponentName, draggedServiceName, draggedAssetId]);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    setConnections(prev => prev.filter(conn => conn.fromId !== nodeId && conn.toId !== nodeId));
    toast("节点已删除");
  }, []);

  const startConnection = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setConnectingFrom(nodeId);
    setIsDraggingConnection(true);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setConnectionDragPos({
          x: moveEvent.clientX - rect.left,
          y: moveEvent.clientY - rect.top,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingConnection(false);
      setConnectingFrom(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const startNodeDrag = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node || isDraggingConnection) return;
    
    setDraggedNode(nodeId);
    
    // Calculate initial offset from mouse to node position
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    
    const initialOffset = {
      x: e.clientX - canvasRect.left - node.x,
      y: e.clientY - canvasRect.top - node.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const newX = Math.max(0, Math.min(rect.width - 192, moveEvent.clientX - rect.left - initialOffset.x));
        const newY = Math.max(0, Math.min(rect.height - 80, moveEvent.clientY - rect.top - initialOffset.y));
        
        setNodes(prev => prev.map(n => 
          n.id === nodeId ? { ...n, x: newX, y: newY } : n
        ));
      }
    };

    const handleMouseUp = () => {
      setDraggedNode(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [nodes, isDraggingConnection]);

  const completeConnection = useCallback((toNodeId: string) => {
    if (!connectingFrom || connectingFrom === toNodeId) {
      setConnectingFrom(null);
      return;
    }

    const fromNode = nodes.find(n => n.id === connectingFrom);
    const toNode = nodes.find(n => n.id === toNodeId);

    if (!fromNode || !toNode) {
      setConnectingFrom(null);
      return;
    }

    if (!canConnect(fromNode.type, toNode.type)) {
      toast("节点连接规则错误", { description: "单向连接规则：任务 → 机器人 → 算法，算法 → 算法" });
      setConnectingFrom(null);
      return;
    }

    // Check if connection already exists
    const existingConnection = connections.find(
      conn => (conn.fromId === connectingFrom && conn.toId === toNodeId) ||
              (conn.fromId === toNodeId && conn.toId === connectingFrom)
    );

    if (existingConnection) {
      toast("节点间已存在连接");
      setConnectingFrom(null);
      return;
    }

    const newConnection: Connection = {
      id: `${connectingFrom}-${toNodeId}`,
      fromId: connectingFrom,
      toId: toNodeId,
    };

    setConnections(prev => [...prev, newConnection]);
    setConnectingFrom(null);
    setIsDraggingConnection(false);
    toast("节点连接成功");
  }, [connectingFrom, nodes, connections]);

  const resetWorkflow = useCallback(() => {
    setNodes([]);
    setConnections([]);
    setConnectingFrom(null);
    setIsDraggingConnection(false);
    toast("工作流已重置");
  }, []);

  const handleNodeClick = useCallback((node: WorkflowNode) => {
    if (node.serviceName === "AI-Design" || node.name === "AI-Design") {
      setSelectedAIDesignNode(node.id);
      setAiDesignDialogOpen(true);
    } else if (node.serviceName === "类脑轴孔装配" || node.name === "类脑轴孔装配") {
      setBrainAssemblyDialogOpen(true);
    }
  }, []);

  const handleSaveRobotConfig = useCallback((config: RobotConfig) => {
    // TODO: 将机器人配置保存到后端或状态管理
    console.log("Saving robot config:", config);
    
    // 这里可以将配置保存到机器人列表
    const newRobot = {
      id: `robot-${Date.now()}`,
      name: `AI设计机器人-${Date.now()}`,
      model: "AI-Design",
      config: config,
      chassis: "custom",
      actuator: "custom",
      working_range: config.upperBody.workRadius,
      weight: config.upperBody.weight + config.lowerBody.weight,
      loading: config.upperBody.payload + config.lowerBody.payload
    };
    
    setRobots(prev => [...prev, newRobot]);
    toast.success("机器人已保存到列表");
  }, []);

  const canExecuteWorkflow = useCallback(() => {
    // 至少需要有一个任务、机器人或算法节点
    if (nodes.length === 0) return false;

    const existingTypes = new Set(nodes.map(node => node.type));
    const hasRequiredNode = existingTypes.has("task") || existingTypes.has("robot") || existingTypes.has("algorithm");
    
    if (!hasRequiredNode) return false;

    // 检查所有节点是否都被连接（没有孤立节点）
    const connectedNodes = new Set<string>();
    connections.forEach(conn => {
      connectedNodes.add(conn.fromId);
      connectedNodes.add(conn.toId);
    });

    return nodes.every(node => connectedNodes.has(node.id)) && connections.length > 0;
  }, [nodes, connections]);

  const getDisabledReason = useCallback(() => {
    if (nodes.length === 0) {
      return "请先添加节点到画布（至少需要一个任务、机器人或算法节点）";
    }

    const existingTypes = new Set(nodes.map(node => node.type));
    const hasRequiredNode = existingTypes.has("task") || existingTypes.has("robot") || existingTypes.has("algorithm");
    
    if (!hasRequiredNode) {
      return "至少需要一个任务、机器人或算法节点";
    }

    if (connections.length === 0) {
      return "请连接节点以形成工作流";
    }

    const connectedNodes = new Set<string>();
    connections.forEach(conn => {
      connectedNodes.add(conn.fromId);
      connectedNodes.add(conn.toId);
    });

    const isolatedNodes = nodes.filter(node => !connectedNodes.has(node.id));
    if (isolatedNodes.length > 0) {
      return "存在未连接的节点，请确保所有节点都已连接";
    }

    return "";
  }, [nodes, connections]);

  // 根据连接关系对算法节点进行拓扑排序
  const getAlgorithmExecutionOrder = useCallback(() => {
    const algorithmNodes = nodes.filter(node => node.type === "algorithm");
    
    // 构建邻接表 (fromId -> [toId])
    const adjacencyList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    
    // 初始化
    algorithmNodes.forEach(node => {
      adjacencyList.set(node.id, []);
      inDegree.set(node.id, 0);
    });
    
    // 构建图
    connections.forEach(conn => {
      const fromNode = nodes.find(n => n.id === conn.fromId);
      const toNode = nodes.find(n => n.id === conn.toId);
      
      // 只处理算法到算法的连接
      if (fromNode?.type === "algorithm" && toNode?.type === "algorithm") {
        adjacencyList.get(conn.fromId)?.push(conn.toId);
        inDegree.set(conn.toId, (inDegree.get(conn.toId) || 0) + 1);
      }
    });
    
    // 拓扑排序 (Kahn算法)
    const queue: string[] = [];
    const result: WorkflowNode[] = [];
    
    // 找到所有入度为0的节点作为起点
    algorithmNodes.forEach(node => {
      if (inDegree.get(node.id) === 0) {
        queue.push(node.id);
      }
    });
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = nodes.find(n => n.id === currentId);
      if (currentNode) {
        result.push(currentNode);
      }
      
      const neighbors = adjacencyList.get(currentId) || [];
      neighbors.forEach(neighborId => {
        const newInDegree = (inDegree.get(neighborId) || 0) - 1;
        inDegree.set(neighborId, newInDegree);
        if (newInDegree === 0) {
          queue.push(neighborId);
        }
      });
    }

    if (result.length !== algorithmNodes.length) {
      throw new Error("算法连接存在环路，请删除循环依赖后再进入仿真实验室");
    }
    
    return result;
  }, [nodes, connections]);

  const executeWorkflow = useCallback(async () => {
    let algorithmOrder: WorkflowNode[];
    try {
      algorithmOrder = getAlgorithmExecutionOrder();
    } catch (error) {
      toast("工作流拓扑检查失败", {
        description: error instanceof Error ? error.message : "算法连接存在环路",
      });
      return;
    }
    
    if (algorithmOrder.length === 0) {
      toast("没有算法节点需要执行");
      return;
    }
    
    setIsExecuting(true);
    setExecutionProgress({ current: 0, total: algorithmOrder.length, currentAlgo: "" });
    
    try {
      setExecutionProgress({
        current: algorithmOrder.length,
        total: algorithmOrder.length,
        currentAlgo: "生成不可变仿真草稿",
      });
      
      // 加载环境和视频监控数据
      const [environmentResponse, videoSurveillanceResponse] = await Promise.all([
        fetch('/data/environment.json'),
        fetch('/data/video_surveillance.json')
      ]);
      
      const environmentData = await environmentResponse.json();
      const videoSurveillanceData = await videoSurveillanceResponse.json();
      
      // 构建监控页面所需的机器人配置数据
      const robotNodes = nodes.filter(node => node.type === "robot");
      const monitoringData = {
        environment: environmentData,
        video_surveillance: videoSurveillanceData,
        robots: robotNodes.map(robotNode => {
          // 找到连接到此机器人的任务节点
          const taskConnection = connections.find(
            conn => conn.toId === robotNode.id && nodes.find(n => n.id === conn.fromId)?.type === "task"
          );
          const taskNode = taskConnection ? nodes.find(n => n.id === taskConnection.fromId) : null;
          
          // 使用BFS查找所有与机器人节点直接或间接相连的算法节点
          const findConnectedAlgorithms = (startNodeId: string): string[] => {
            const visited = new Set<string>();
            const queue: string[] = [startNodeId];
            const algorithmNames: string[] = [];
            
            while (queue.length > 0) {
              const currentId = queue.shift()!;
              if (visited.has(currentId)) continue;
              visited.add(currentId);
              
              const currentNode = nodes.find(n => n.id === currentId);
              if (currentNode && currentNode.type === 'algorithm') {
                algorithmNames.push(currentNode.name);
              }
              
              // 查找所有与当前节点相连的节点（双向）
              connections.forEach(conn => {
                if (conn.fromId === currentId && !visited.has(conn.toId)) {
                  queue.push(conn.toId);
                } else if (conn.toId === currentId && !visited.has(conn.fromId)) {
                  queue.push(conn.fromId);
                }
              });
            }
            
            return algorithmNames;
          };
          
          const algorithmNames = findConnectedAlgorithms(robotNode.id);
          
          // 从robots数据中找到对应的机器人详细信息
          const robotData = robots.find(r => r.name === robotNode.name);
          
          // 从 HTML 中提取纯文本（如果 task_name 包含 <a> 标签）
          const extractTextFromHtml = (html: string) => {
            const div = document.createElement('div');
            div.innerHTML = html;
            return div.textContent || div.innerText || '';
          };
          
          return {
            id: robotData?.id || 0,
            name: robotNode.name,
            task_name: taskNode?.name ? extractTextFromHtml(taskNode.name) : "",
            algorithm: algorithmNames,
            battery: robotData?.battery || { url: "", topic: "" },
            speed: robotData?.speed || { url: "", topic: "" },
            position_topic: robotData?.position_topic || { url: "", topic: "" },
            vision: {
              head: robotData?.vision?.head ? {
                url: robotData.vision.head.url || "",
                m3u8: robotData.vision.head.m3u8 || robotData.vision.head.topic || ""
              } : { url: "", m3u8: "" },
              left_hand: robotData?.vision?.left_hand ? {
                url: robotData.vision.left_hand.url || "",
                m3u8: robotData.vision.left_hand.m3u8 || robotData.vision.left_hand.topic || ""
              } : { url: "", m3u8: "" },
              right_hand: robotData?.vision?.right_hand ? {
                url: robotData.vision.right_hand.url || "",
                m3u8: robotData.vision.right_hand.m3u8 || robotData.vision.right_hand.topic || ""
              } : { url: "", m3u8: "" },
              obstacle: robotData?.vision?.obstacle || { url: "", topic: "" }
            },
            end_effector_force_topic: robotData?.end_effector_force_topic || { url: "", topic: "" },
            joint_angles_topic: robotData?.joint_angles_topic || { url: "", topic: "" }
          };
        })
      };
      
      // 检查是否包含训练场任务
      const hasTrainingTask = nodes.some(node => 
        node.type === "task" && node.name.includes("训练场")
      );
      const workflowTasks = nodes.filter(node => node.type === "task");
      const toPlainText = (value: string) => {
        const element = document.createElement("div");
        element.innerHTML = value;
        return element.textContent || element.innerText || value;
      };
      const simulationData = {
        name: workflowTasks.map(node => toPlainText(node.name)).join(" + ") || "机器人算法工作流",
        algorithms: algorithmOrder.map(node => ({
          id: node.id,
          assetId: node.assetId,
          name: node.serviceName || node.name,
          displayName: node.name,
        })),
        robots: monitoringData.robots,
        nodes,
        connections,
        monitoringData,
      };
      
      if (hasTrainingTask) {
        toast("工作流执行成功，跳转到机器人训练场");
        setTimeout(() => {
          navigate("/training");
        }, 1000);
      } else {
        sessionStorage.setItem("simulationWorkflow", JSON.stringify(simulationData));
        toast("工作流拓扑检查通过，正在进入仿真实验室");
        setTimeout(() => {
          navigate("/simulation", { state: { simulationData } });
        }, 1000);
      }
      
    } catch (error) {
      console.error("工作流执行失败:", error);
      toast("工作流执行失败", { 
        description: error instanceof Error ? error.message : "未知错误" 
      });
    } finally {
      setIsExecuting(false);
    }
  }, [navigate, getAlgorithmExecutionOrder, nodes, connections, robots]);

  const groupedComponents = componentTypes.reduce((acc, component) => {
    if (!acc[component.category]) {
      acc[component.category] = [];
    }
    acc[component.category].push(component);
    return acc;
  }, {} as Record<string, ComponentType[]>);

  return (
    <div className="flex h-screen gap-6">
      {/* Component Library */}
      <Card className="w-80 h-[90%] flex flex-col">
        <CardHeader className="flex-shrink-0">
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            组件库
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-2">
          {/* 任务 */}
          <Collapsible open={openSections.tasks} onOpenChange={() => toggleSection('tasks')}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded-lg transition-colors">
              <ChevronRight className={`h-4 w-4 transition-transform ${openSections.tasks ? 'rotate-90' : ''}`} />
              <span className="text-sm font-medium">任务</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 mt-1 ml-4">
              {tasks.map((task, index) => (
                <div
                  key={`task-${task.id || index}`}
                  draggable
                  onDragStart={(e) => handleComponentDragStart(e, 'task', task.pipeline_url )}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent cursor-grab active:cursor-grabbing transition-colors"
                >
                  <ListTodo className="h-4 w-4 text-primary" />
                  <span 
                    className="text-sm pointer-events-none"
                    dangerouslySetInnerHTML={{ __html: task.pipeline_url }}
                  />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          {/* 机器人 */}
          <Collapsible open={openSections.robots} onOpenChange={() => toggleSection('robots')}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded-lg transition-colors">
              <ChevronRight className={`h-4 w-4 transition-transform ${openSections.robots ? 'rotate-90' : ''}`} />
              <span className="text-sm font-medium">机器人</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 mt-1 ml-4">
              {robots.map((robot, index) => (
                <div
                  key={`robot-${index}`}
                  draggable
                  onDragStart={(e) => handleComponentDragStart(e, 'robot', robot.name)}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent cursor-grab active:cursor-grabbing transition-colors"
                >
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="text-sm">{robot.name}</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          {/* 算法 */}
          <Collapsible open={openSections.algorithms} onOpenChange={() => toggleSection('algorithms')}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded-lg transition-colors">
              <ChevronRight className={`h-4 w-4 transition-transform ${openSections.algorithms ? 'rotate-90' : ''}`} />
              <span className="text-sm font-medium">算法</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 mt-1 ml-4">
              {Object.entries(algorithmsByProject).map(([projectId, projectData]: [string, any]) => (
                <Collapsible 
                  key={projectId}
                  open={openAlgoProjects[projectId]}
                  onOpenChange={() => toggleAlgoProject(projectId)}
                >
                  <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-accent/50 rounded-lg transition-colors">
                    <ChevronRight className={`h-3 w-3 transition-transform ${openAlgoProjects[projectId] ? 'rotate-90' : ''}`} />
                    <span className="text-xs font-medium text-muted-foreground">{projectData.projectName}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 mt-1 ml-4">
                    {projectData.algorithms.map((algo: any, index: number) => {
                      const AlgoIcon = algo.name === 'AI-Design' ? Brain : Cpu;
                      return (
                        <div
                          key={`algo-${projectId}-${index}`}
                          draggable
                          onDragStart={(e) => handleComponentDragStart(
                            e,
                            'algorithm',
                            algo.describe || `算法-${algo.id}`,
                            algo.name,
                            algo.id,
                          )}
                          className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent cursor-grab active:cursor-grabbing transition-colors"
                        >
                          <AlgoIcon className="h-4 w-4 text-primary" />
                          <span className="text-sm">{algo.describe}</span>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Workflow Canvas */}
      <Card className="flex-1 flex flex-col h-[90%]">
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              工作流画布
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <div className="space-y-3">
                    <h4 className="font-medium">使用方法</h4>
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p><strong>添加节点：</strong>从左侧组件库拖拽组件到画布中</p>
                      <p><strong>连接节点：</strong>点击节点右上角的加号，拖拽到目标节点进行连接</p>
                      <p><strong>移动节点：</strong>直接拖拽节点到想要的位置</p>
                      <p><strong>删除节点：</strong>点击节点右上角的删除按钮</p>
                      <p><strong>连接规则：</strong>任务 → 机器人 → 算法（单向连接，不可反向）</p>
                      <p><strong>运行工作流：</strong>至少有一个任务、机器人或算法节点，且所有节点都已连接后，即可执行工作流</p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </CardTitle>
            
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={nodes.length === 0}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    重置
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认重置工作流</AlertDialogTitle>
                    <AlertDialogDescription>
                      此操作将删除画布中的所有节点和连接，无法撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={resetWorkflow}>确认重置</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            disabled={!canExecuteWorkflow()}
                            className="bg-gradient-primary"
                          >
                            <Play className="h-4 w-4 mr-2" />
                            进入仿真实验室
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认生成仿真草稿</AlertDialogTitle>
                            <AlertDialogDescription>
                              将先检查工作流拓扑并生成仿真草稿；此操作不会部署容器，随后进入机器人仿真实验室完成严格预检。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={executeWorkflow}>检查并进入</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </span>
                  </TooltipTrigger>
                  {!canExecuteWorkflow() && (
                    <TooltipContent>
                      <p>{getDisabledReason()}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 p-0">
          <div 
            ref={canvasRef}
            className="relative bg-gradient-card border-2 border-dashed border-border h-full min-h-[500px] overflow-hidden"
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
          >
            {/* Connections */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
              {connections.map((connection) => {
                const fromNode = nodes.find(n => n.id === connection.fromId);
                const toNode = nodes.find(n => n.id === connection.toId);
                if (!fromNode || !toNode) return null;

                // Calculate node centers
                const fromCenterX = fromNode.x + 96; // w-48 = 192px, so center is 96px
                const fromCenterY = fromNode.y + 40; // h-20 = 80px, so center is 40px
                const toCenterX = toNode.x + 96;
                const toCenterY = toNode.y + 40;

                // Calculate relative position
                const deltaX = toCenterX - fromCenterX;
                const deltaY = toCenterY - fromCenterY;

                // Determine best connection points based on relative position
                let fromX, fromY, toX, toY;

                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                  // Horizontal connection is preferred
                  if (deltaX > 0) {
                    // toNode is to the right of fromNode
                    fromX = fromNode.x + 192; // right edge of fromNode
                    fromY = fromCenterY;
                    toX = toNode.x; // left edge of toNode
                    toY = toCenterY; // vertically centered
                  } else {
                    // toNode is to the left of fromNode
                    fromX = fromNode.x; // left edge of fromNode
                    fromY = fromCenterY;
                    toX = toNode.x + 192; // right edge of toNode
                    toY = toCenterY; // vertically centered
                  }
                } else {
                  // Vertical connection is preferred
                  if (deltaY > 0) {
                    // toNode is below fromNode
                    fromX = fromCenterX;
                    fromY = fromNode.y + 80; // bottom edge of fromNode
                    toX = toCenterX; // horizontally centered
                    toY = toNode.y; // top edge of toNode
                  } else {
                    // toNode is above fromNode
                    fromX = fromCenterX;
                    fromY = fromNode.y; // top edge of fromNode
                    toX = toCenterX; // horizontally centered
                    toY = toNode.y + 80; // bottom edge of toNode
                  }
                }

                // Create smooth curved path using cubic Bezier curve for better arrow alignment
                // Control points are offset perpendicular to the main direction
                let cp1X, cp1Y, cp2X, cp2Y;
                
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                  // Horizontal connection - control points move horizontally
                  const offset = Math.abs(toX - fromX) * 0.5;
                  cp1X = fromX + (deltaX > 0 ? offset : -offset);
                  cp1Y = fromY;
                  cp2X = toX - (deltaX > 0 ? offset : -offset);
                  cp2Y = toY;
                } else {
                  // Vertical connection - control points move vertically
                  const offset = Math.abs(toY - fromY) * 0.5;
                  cp1X = fromX;
                  cp1Y = fromY + (deltaY > 0 ? offset : -offset);
                  cp2X = toX;
                  cp2Y = toY - (deltaY > 0 ? offset : -offset);
                }
                
                const pathData = `M ${fromX} ${fromY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${toX} ${toY}`;

                return (
                  <g key={connection.id}>
                    <path
                      d={pathData}
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      fill="none"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      markerEnd="url(#arrowhead-auto)"
                    />
                  </g>
                );
              })}
              
              {/* Dragging connection line */}
              {isDraggingConnection && connectingFrom && (
                <g>
                  {(() => {
                    const fromNode = nodes.find(n => n.id === connectingFrom);
                    if (!fromNode) return null;
                    
                    // Calculate from node center
                    const fromCenterX = fromNode.x + 96;
                    const fromCenterY = fromNode.y + 40;
                    
                    // Calculate relative position to drag position
                    const deltaX = connectionDragPos.x - fromCenterX;
                    const deltaY = connectionDragPos.y - fromCenterY;
                    
                    // Determine best connection point
                    let fromX, fromY;
                    
                    if (Math.abs(deltaX) > Math.abs(deltaY)) {
                      // Horizontal connection preferred
                      if (deltaX > 0) {
                        fromX = fromNode.x + 192; // right edge
                        fromY = fromCenterY;
                      } else {
                        fromX = fromNode.x; // left edge
                        fromY = fromCenterY;
                      }
                    } else {
                      // Vertical connection preferred
                      if (deltaY > 0) {
                        fromX = fromCenterX;
                        fromY = fromNode.y + 80; // bottom edge
                      } else {
                        fromX = fromCenterX;
                        fromY = fromNode.y; // top edge
                      }
                    }
                    
                    return (
                      <line
                        x1={fromX}
                        y1={fromY}
                        x2={connectionDragPos.x}
                        y2={connectionDragPos.y}
                        stroke="hsl(var(--primary))"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        markerEnd="url(#arrowhead-auto)"
                      />
                    );
                  })()}
                </g>
              )}
              
              <defs>
                {/* Auto-rotating arrow that adapts to any angle */}
                <marker
                  id="arrowhead-auto"
                  markerWidth="10"
                  markerHeight="7"
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill="hsl(var(--primary))"
                  />
                </marker>
              </defs>
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const Icon = node.name === "AI-Design" ? Brain : getNodeIcon(node.type);
              return (
                <div
                  key={node.id}
                  className={`absolute group ${connectingFrom === node.id ? 'ring-2 ring-primary' : ''}`}
                  style={{ left: node.x, top: node.y }}
                >
                  <Card className="w-48 shadow-card hover:shadow-elevation transition-all cursor-pointer relative">
                    <button
                      onClick={() => deleteNode(node.id)}
                      className="absolute -top-2 -right-2 h-6 w-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center hover:bg-destructive/80 transition-colors z-20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    
                    <div
                      className="absolute top-1/2 -right-3 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onMouseDown={(e) => startConnection(e, node.id)}
                    >
                      <button className="h-6 w-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center hover:bg-primary/80 cursor-crosshair">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    <CardContent 
                      className={`p-4 ${draggedNode === node.id ? 'cursor-grabbing' : 'cursor-move'} select-none`}
                      onMouseDown={(e) => startNodeDrag(e, node.id)}
                      onMouseUp={() => isDraggingConnection && completeConnection(node.id)}
                      onClick={(e) => {
                        // 如果不是拖动操作，则处理点击
                        if (!isDraggingConnection && !draggedNode) {
                          e.stopPropagation();
                          handleNodeClick(node);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {node.type === 'task' ? (
                            <p 
                              className="text-sm font-medium truncate pointer-events-none"
                              dangerouslySetInnerHTML={{ __html: node.name }}
                            />
                          ) : (
                            <p className="text-sm font-medium truncate">{node.name}</p>
                          )}
                          <p className="text-xs text-muted-foreground capitalize">{node.type}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
                    <Settings className="h-8 w-8" />
                  </div>
                  <div>
                    <p className="text-lg font-medium">开始构建工作流</p>
                    <p className="text-sm">从左侧组件库拖拽组件到此处</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Execution Progress Dialog */}
      <AlertDialog open={isExecuting}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>正在执行工作流</AlertDialogTitle>
            <AlertDialogDescription>
              请稍候，正在检查拓扑并生成仿真草稿...
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>进度</span>
                <span>{executionProgress.current} / {executionProgress.total}</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(executionProgress.current / executionProgress.total) * 100}%` }}
                />
              </div>
              {executionProgress.currentAlgo && (
                <p className="text-sm text-muted-foreground text-center">
                  当前步骤: {executionProgress.currentAlgo}
                </p>
              )}
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI Design Dialog */}
      <AIDesignDialog
        open={aiDesignDialogOpen}
        onOpenChange={setAiDesignDialogOpen}
        onSave={handleSaveRobotConfig}
      />

      {/* Brain Assembly Dialog */}
      <Dialog open={brainAssemblyDialogOpen} onOpenChange={setBrainAssemblyDialogOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>类脑轴孔装配</DialogTitle>
          </DialogHeader>
          <div className="flex-1 p-4 pt-2 h-[80vh]">
            <iframe
              src={API_CONFIG.brainAssemblyUrl}
              className="w-full h-full border-0 rounded-lg"
              title="类脑轴孔装配"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
