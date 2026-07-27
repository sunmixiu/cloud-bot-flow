import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Bot, 
  Cpu, 
  ListTodo, 
  Database,
  Plus, 
  MoreHorizontal,
  Info,
  Edit,
  Trash2
} from "lucide-react";
import { EditResourceDialog, Resource } from "@/components/resource/EditResourceDialog";
import { AddResourceDialog } from "@/components/resource/AddResourceDialog";
import { useToast } from "@/hooks/use-toast";
import { algorithmApi, datasetApi, pipelineApi, resourceApi } from "@/services/api";

interface WebSocketTopic {
  url: string;
  topic: string;
}

interface Robot extends Resource {
  model: string;
  chassis: string;
  actuator: string;
  working_range: string;
  weight: string;
  loading: string;
  battery: WebSocketTopic;
  speed: WebSocketTopic;
  vision: {
    head: WebSocketTopic;
    left_hand: WebSocketTopic;
    right_hand: WebSocketTopic;
    obstacle: WebSocketTopic;
  };
  end_effector_force_topic: WebSocketTopic;
  joint_angles_topic: WebSocketTopic;
}

interface Task {
  id: number;
  project: {
    created_on: string;
    changed_on: string;
    id: number;
    name: string;
    describe: string;
    type: string;
    expand: string;
  };
  pipeline_url: string;
  creator: string;
  modified: string;
}

interface Algorithm {
  id: number;
  name: string;
  describe: string;
  created_on: string;
  changed_on: string;
  entrypoint: string;
  dockerfile: string;
  gitpath: string;
  project: {
    id: number;
    name: string;
    describe: string;
    created_on: string;
    changed_on: string;
    type: string;
    expand: string;
  };
}


interface Dataset {
  id: number;
  icon_html: string;
  name: string;
  version: string;
  label_html: string;
  describe: string;
  owner: string;
  path_html: string;
  download_url_html: string;
}


export default function ResourceManagement() {
  const [activeTab, setActiveTab] = useState("robots");
  const [robots, setRobots] = useState<Robot[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [algorithms, setAlgorithms] = useState<Algorithm[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [selectedResourceType, setSelectedResourceType] = useState<"robots" | "tasks" | "algorithms" | "datasets">("robots");
  const [deleteResourceId, setDeleteResourceId] = useState<string>("");
  const [deleteResourceType, setDeleteResourceType] = useState<"robots" | "tasks" | "algorithms" | "datasets">("robots");
  const [detailsResource, setDetailsResource] = useState<Robot | Task | Algorithm | Dataset | null>(null);
  const [detailsResourceType, setDetailsResourceType] = useState<"robots" | "tasks" | "algorithms" | "datasets">("robots");
  
  const { toast } = useToast();

  useEffect(() => {
    // Load data from JSON files and API
    const loadData = async () => {
      try {
        // 加载所有数据
        const [robotsData, tasksResponse, datasetsResponse, algorithmsResponse] = await Promise.all([
          resourceApi.getRobots(),
          pipelineApi.getList(),
          datasetApi.getList(),
          algorithmApi.getList()
        ]);
        
        setRobots(robotsData as Robot[]);
        
        // 处理任务数据 - 从API响应中提取data数组
        const tasksData = (tasksResponse as any).result?.data || [];
        setTasks(tasksData as Task[]);
        
        // 处理数据集数据 - 从API响应中提取data数组
        const datasetsData = (datasetsResponse as any).result?.data || [];
        setDatasets(datasetsData as Dataset[]);
        
        // 处理算法数据 - 遍历每个算法ID获取详细信息
        const algorithmsList = (algorithmsResponse as any).result?.data || [];
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
              } as Algorithm;
            } catch (error) {
              console.error(`Failed to load algorithm ${algo.id}:`, error);
              return null;
            }
          })
        );
        
        // 过滤掉加载失败的算法
        setAlgorithms(detailedAlgorithms.filter(algo => algo !== null) as Algorithm[]);
      } catch (error) {
        console.error('Error loading data:', error);
        toast({
          title: "加载失败",
          description: "无法加载资源数据",
          variant: "destructive"
        });
      }
    };
    
    loadData();
  }, [toast]);

  const handleDetails = (resource: Robot | Task | Algorithm | Dataset, type: "robots" | "tasks" | "algorithms" | "datasets") => {
    setDetailsResource(resource);
    setDetailsResourceType(type);
    setDetailsDialogOpen(true);
  };

  const handleEdit = (resource: Resource | Algorithm | Task | Dataset, type: "robots" | "tasks" | "algorithms" | "datasets") => {
    setSelectedResource(resource as Resource);
    setSelectedResourceType(type);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (id: string, type: "robots" | "tasks" | "algorithms" | "datasets") => {
    setDeleteResourceId(id);
    setDeleteResourceType(type);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      switch (deleteResourceType) {
        case "robots":
          await resourceApi.delete(deleteResourceId);
          setRobots(prev => prev.filter(r => r.id.toString() !== deleteResourceId));
          break;
        case "tasks":
          await pipelineApi.delete(Number(deleteResourceId));
          setTasks(prev => prev.filter(t => t.id.toString() !== deleteResourceId));
          break;
        case "algorithms":
          await algorithmApi.delete(deleteResourceId);
          setAlgorithms(prev => prev.filter(a => a.id.toString() !== deleteResourceId));
          break;
        case "datasets":
          await datasetApi.delete(Number(deleteResourceId));
          setDatasets(prev => prev.filter(d => d.id.toString() !== deleteResourceId));
          break;
      }
      toast({
        title: "删除成功",
        description: "资源已从本地后端删除"
      });
      setDeleteDialogOpen(false);
      setDeleteResourceId("");
    } catch (error) {
      console.error("Delete resource failed:", error);
      toast({
        title: "删除失败",
        description: "本地后端未能删除该资源",
        variant: "destructive"
      });
    }
  };

  const handleSave = async (resource: Resource) => {
    try {
      let savedResource: any = resource;
      switch (selectedResourceType) {
        case "robots": {
          const response = await resourceApi.update(resource.id, resource);
          savedResource = response.result;
          setRobots(prev => prev.map(r => r.id.toString() === resource.id.toString() ? savedResource as Robot : r));
          break;
        }
        case "tasks": {
          const response = await pipelineApi.update(Number(resource.id), resource);
          savedResource = response.result;
          setTasks(prev => prev.map(t => t.id.toString() === resource.id.toString() ? savedResource as Task : t));
          break;
        }
        case "algorithms": {
          const response = await algorithmApi.update(resource.id, resource);
          savedResource = response.result;
          setAlgorithms(prev => prev.map(a => a.id.toString() === resource.id.toString() ? savedResource as Algorithm : a));
          break;
        }
        case "datasets": {
          const response = await datasetApi.update(Number(resource.id), resource);
          savedResource = response.result;
          setDatasets(prev => prev.map(d => d.id.toString() === resource.id.toString() ? savedResource as Dataset : d));
          break;
        }
      }
      toast({
        title: "保存成功",
        description: "资源信息已持久化到本地后端"
      });
    } catch (error) {
      console.error("Save resource failed:", error);
      toast({
        title: "保存失败",
        description: "本地后端未能保存该资源",
        variant: "destructive"
      });
    }
  };

  const handleAdd = async (type: "robots" | "tasks" | "algorithms" | "datasets", resource: Resource) => {
    try {
      let createdResource: any = resource;
      switch (type) {
        case "robots": {
          const response = await resourceApi.create(resource);
          createdResource = response.result;
          setRobots(prev => [...prev, createdResource as Robot]);
          break;
        }
        case "tasks": {
          const response = await pipelineApi.create(resource);
          createdResource = response.result;
          setTasks(prev => [...prev, createdResource as Task]);
          break;
        }
        case "algorithms": {
          const response = await algorithmApi.create(resource);
          createdResource = response.result;
          setAlgorithms(prev => [...prev, createdResource as Algorithm]);
          break;
        }
        case "datasets": {
          const response = await datasetApi.create(resource);
          createdResource = response.result;
          setDatasets(prev => [...prev, createdResource as Dataset]);
          break;
        }
      }
      toast({
        title: "添加成功",
        description: "新资源已持久化到本地后端"
      });
    } catch (error) {
      console.error("Add resource failed:", error);
      toast({
        title: "添加失败",
        description: "本地后端未能添加该资源",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">资源管理</h1>
        </div>
        <Button className="bg-gradient-primary" onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          添加资源
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="robots" className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            机器人
          </TabsTrigger>
          <TabsTrigger value="tasks" className="flex items-center gap-2">
            <ListTodo className="h-4 w-4" />
            任务
          </TabsTrigger>
          <TabsTrigger value="algorithms" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            算法
          </TabsTrigger>
          <TabsTrigger value="datasets" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            数据
          </TabsTrigger>
        </TabsList>

        <TabsContent value="robots" className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>型号</TableHead>
                  <TableHead>底盘</TableHead>
                  <TableHead>执行器</TableHead>
                  <TableHead>工作范围</TableHead>
                  <TableHead>自重</TableHead>
                  <TableHead>负载</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {robots.map((robot) => (
                  <TableRow key={robot.id}>
                    <TableCell className="font-medium">{robot.name}</TableCell>
                    <TableCell>{robot.model}</TableCell>
                    <TableCell>{robot.chassis}</TableCell>
                    <TableCell>{robot.actuator}</TableCell>
                    <TableCell>{robot.working_range}</TableCell>
                    <TableCell>{robot.weight}</TableCell>
                    <TableCell>{robot.loading}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDetails(robot, "robots")}>
                            <Info className="mr-2 h-4 w-4" />
                            详情
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(robot, "robots")}>
                            <Edit className="mr-2 h-4 w-4" />
                            修改
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeleteClick(robot.id, "robots")}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务名称</TableHead>
                  <TableHead>项目名称</TableHead>
                  <TableHead>创建者</TableHead>
                  <TableHead>修改时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div dangerouslySetInnerHTML={{ __html: task.pipeline_url }} className="pointer-events-none" />
                    </TableCell>
                    <TableCell>{task.project?.name || '-'}</TableCell>
                    <TableCell>{task.creator}</TableCell>
                    <TableCell>{task.modified}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDetails(task, "tasks")}>
                            <Info className="mr-2 h-4 w-4" />
                            详情
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(task, "tasks")}>
                            <Edit className="mr-2 h-4 w-4" />
                            修改
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeleteClick(task.id.toString(), "tasks")}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="algorithms" className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>描述</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>项目名称</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>修改时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {algorithms.map((algorithm) => (
                  <TableRow key={algorithm.id}>
                    <TableCell className="font-medium">{algorithm.describe}</TableCell>
                    <TableCell className="max-w-xs truncate">{algorithm.name}</TableCell>
                    <TableCell>{algorithm.project?.name || '-'}</TableCell>
                    <TableCell>{new Date(algorithm.created_on).toLocaleDateString('zh-CN')}</TableCell>
                    <TableCell>{new Date(algorithm.changed_on).toLocaleDateString('zh-CN')}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDetails(algorithm, "algorithms")}>
                            <Info className="mr-2 h-4 w-4" />
                            详情
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(algorithm, "algorithms")}>
                            <Edit className="mr-2 h-4 w-4" />
                            修改
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeleteClick(algorithm.id.toString(), "algorithms")}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="datasets" className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>中文名</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>责任人</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((dataset) => (
                  <TableRow key={dataset.id}>
                    <TableCell className="font-medium">{dataset.name}</TableCell>
                    <TableCell>
                      <div dangerouslySetInnerHTML={{ __html: dataset.label_html }} />
                    </TableCell>
                    <TableCell>{dataset.version}</TableCell>
                    <TableCell>{dataset.owner}</TableCell>
                    <TableCell className="max-w-xs truncate">{dataset.describe}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDetails(dataset, "datasets")}>
                            <Info className="mr-2 h-4 w-4" />
                            详情
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(dataset, "datasets")}>
                            <Edit className="mr-2 h-4 w-4" />
                            修改
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeleteClick(dataset.id.toString(), "datasets")}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <EditResourceDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        resource={selectedResource}
        resourceType={selectedResourceType}
        onSave={handleSave}
      />

      <AddResourceDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAdd}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要删除这个资源吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>资源详情</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {detailsResourceType === "robots" && detailsResource && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">ID:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).id}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">名称:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">型号:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).model}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">底盘:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).chassis}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">执行器:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).actuator}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">工作范围:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).working_range}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">自重:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).weight}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">负载:</span>
                    <p className="text-sm mt-1">{(detailsResource as Robot).loading}</p>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-3">电池信息</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">URL:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).battery.url}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Topic:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).battery.topic}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-3">速度信息</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">URL:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).speed.url}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Topic:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).speed.topic}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-3">视觉系统</h4>
                  <div className="space-y-3">
                    <div className="bg-muted p-3 rounded">
                      <h5 className="text-xs font-semibold mb-2">头部视觉</h5>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-xs text-muted-foreground">URL:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.head.url}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Topic:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.head.topic}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-muted p-3 rounded">
                      <h5 className="text-xs font-semibold mb-2">左手视觉</h5>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-xs text-muted-foreground">URL:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.left_hand.url}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Topic:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.left_hand.topic}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-muted p-3 rounded">
                      <h5 className="text-xs font-semibold mb-2">右手视觉</h5>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-xs text-muted-foreground">URL:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.right_hand.url}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Topic:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.right_hand.topic}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-muted p-3 rounded">
                      <h5 className="text-xs font-semibold mb-2">障碍物检测</h5>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-xs text-muted-foreground">URL:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.obstacle.url}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Topic:</span>
                          <p className="text-xs font-mono">{(detailsResource as Robot).vision.obstacle.topic}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-3">末端执行器力信息</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">URL:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).end_effector_force_topic.url}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Topic:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).end_effector_force_topic.topic}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-3">关节角度信息</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">URL:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).joint_angles_topic.url}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Topic:</span>
                      <p className="text-xs mt-1 font-mono">{(detailsResource as Robot).joint_angles_topic.topic}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {detailsResourceType === "tasks" && detailsResource && (
              <div className="space-y-3">
                <div>
                  <span className="text-sm font-medium text-muted-foreground">任务名称:</span>
                  <div className="text-sm mt-1 pointer-events-none" dangerouslySetInnerHTML={{ __html: (detailsResource as Task).pipeline_url }} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">创建者:</span>
                    <p className="text-sm mt-1">{(detailsResource as Task).creator}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">修改时间:</span>
                    <p className="text-sm mt-1">{(detailsResource as Task).modified}</p>
                  </div>
                </div>
                {(detailsResource as Task).project && (
                  <div className="border-t pt-3 mt-3">
                    <h4 className="text-sm font-semibold mb-3">项目信息</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">项目名称:</span>
                        <p className="text-sm mt-1">{(detailsResource as Task).project.name}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">项目ID:</span>
                        <p className="text-sm mt-1">{(detailsResource as Task).project.id}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">项目类型:</span>
                        <p className="text-sm mt-1">{(detailsResource as Task).project.type}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">创建时间:</span>
                        <p className="text-sm mt-1">{new Date((detailsResource as Task).project.created_on).toLocaleString('zh-CN')}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">修改时间:</span>
                        <p className="text-sm mt-1">{new Date((detailsResource as Task).project.changed_on).toLocaleString('zh-CN')}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm font-medium text-muted-foreground">项目描述:</span>
                        <p className="text-sm mt-1">{(detailsResource as Task).project.describe}</p>
                      </div>
                      {(detailsResource as Task).project.expand && (
                        <div className="col-span-2">
                          <span className="text-sm font-medium text-muted-foreground">扩展信息:</span>
                          <p className="text-xs mt-1 font-mono bg-muted p-2 rounded">{(detailsResource as Task).project.expand}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {detailsResourceType === "algorithms" && detailsResource && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">ID:</span>
                    <p className="text-sm mt-1">{(detailsResource as Algorithm).id}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-muted-foreground">描述:</span>
                    <p className="text-sm mt-1">{(detailsResource as Algorithm).describe}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-muted-foreground">名称:</span>
                    <p className="text-sm mt-1 break-all">{(detailsResource as Algorithm).name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">创建时间:</span>
                    <p className="text-sm mt-1">{new Date((detailsResource as Algorithm).created_on).toLocaleString('zh-CN')}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">修改时间:</span>
                    <p className="text-sm mt-1">{new Date((detailsResource as Algorithm).changed_on).toLocaleString('zh-CN')}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-muted-foreground">入口点:</span>
                    <p className="text-sm mt-1 font-mono">{(detailsResource as Algorithm).entrypoint}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-muted-foreground">Git路径:</span>
                    <p className="text-sm mt-1 font-mono break-all">{(detailsResource as Algorithm).gitpath}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-muted-foreground">Dockerfile:</span>
                    <p className="text-sm mt-1 font-mono break-all">{(detailsResource as Algorithm).dockerfile}</p>
                  </div>
                </div>
                {(detailsResource as Algorithm).project && (
                  <div className="border-t pt-3 mt-3">
                    <h4 className="text-sm font-semibold mb-3">项目信息</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">项目名称:</span>
                        <p className="text-sm mt-1">{(detailsResource as Algorithm).project.name}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">项目ID:</span>
                        <p className="text-sm mt-1">{(detailsResource as Algorithm).project.id}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">项目类型:</span>
                        <p className="text-sm mt-1">{(detailsResource as Algorithm).project.type}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">创建时间:</span>
                        <p className="text-sm mt-1">{new Date((detailsResource as Algorithm).project.created_on).toLocaleString('zh-CN')}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">修改时间:</span>
                        <p className="text-sm mt-1">{new Date((detailsResource as Algorithm).project.changed_on).toLocaleString('zh-CN')}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm font-medium text-muted-foreground">项目描述:</span>
                        <p className="text-sm mt-1">{(detailsResource as Algorithm).project.describe}</p>
                      </div>
                      {(detailsResource as Algorithm).project.expand && (
                        <div className="col-span-2">
                          <span className="text-sm font-medium text-muted-foreground">扩展信息:</span>
                          <p className="text-xs mt-1 font-mono bg-muted p-2 rounded">{(detailsResource as Algorithm).project.expand}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {detailsResourceType === "datasets" && detailsResource && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">ID:</span>
                    <p className="text-sm mt-1">{(detailsResource as Dataset).id}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">名称:</span>
                    <p className="text-sm mt-1">{(detailsResource as Dataset).name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">中文名:</span>
                    <div className="text-sm mt-1" dangerouslySetInnerHTML={{ __html: (detailsResource as Dataset).label_html }} />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">版本:</span>
                    <p className="text-sm mt-1">{(detailsResource as Dataset).version}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">责任人:</span>
                    <p className="text-sm mt-1">{(detailsResource as Dataset).owner}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-muted-foreground">描述:</span>
                    <p className="text-sm mt-1">{(detailsResource as Dataset).describe}</p>
                  </div>
                  {(detailsResource as Dataset).path_html && (
                    <div className="col-span-2">
                      <span className="text-sm font-medium text-muted-foreground">容器内路径:</span>
                      <div className="text-sm mt-1 bg-muted p-2 rounded" dangerouslySetInnerHTML={{ __html: (detailsResource as Dataset).path_html }} />
                    </div>
                  )}
                  {(detailsResource as Dataset).download_url_html && (
                    <div className="col-span-2">
                      <span className="text-sm font-medium text-muted-foreground">下载地址:</span>
                      <div className="text-sm mt-1 bg-muted p-2 rounded" dangerouslySetInnerHTML={{ __html: (detailsResource as Dataset).download_url_html }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
