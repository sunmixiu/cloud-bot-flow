import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Loader2, Send, ChevronLeft, ChevronRight, Package, Eye } from "lucide-react";
import { CombinedRobotPreviewDialog } from "./CombinedRobotPreviewDialog";
import { mqttApi, MQTT_TOPICS, API_CONFIG, API_ENDPOINTS, robotDesignApi, robotImageUrl } from "@/services/api";
import type { MqttClient } from "mqtt";
import ReactECharts from 'echarts-for-react';

interface AIDesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (robotConfig: RobotConfig) => void;
}

// 保留 RobotConfig 接口以保持向后兼容
export interface RobotConfig {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  upperBody?: {
    dof: string;
    payload: number;
    weight: number;
    workRadius: number;
  };
  lowerBody?: {
    dof: string;
    payload: number;
    weight: number;
    speed: number;
  };
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface GeneratedRobot {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
}

interface RobotPart {
  id: string;
  name: string;
  imageUrl: string;
  type: 'upper' | 'lower';
  length?: number; // 上半身使用：工作半径
  velocity?: number; // 下半身使用：速度
  mass?: number;
  load?: number;
  dofs?: number;
  xmlPath?: string;
}

interface RobotDataCache {
  [robotId: string]: {
    imageUrl: string;
    length?: number; // 上半身使用：工作半径
    velocity?: number; // 下半身使用：速度
    mass?: number;
    load?: number;
    dofs?: number;
    xmlPath?: string;
  };
}

// 图片缓存接口
interface ImageCache {
  [robotId: string]: string; // robotId -> blob URL
}

interface PartModeParams {
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

interface ParameterHistory {
  index: number;
  payload: number;
  weight: number;
  workRadius?: number;
  speed?: number;
}

export function AIDesignDialog({ open, onOpenChange, onSave }: AIDesignDialogProps) {
  const [isPartMode, setIsPartMode] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "你好！我是AI机器人设计助手，请告诉我您的机器人设计需求。" }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingUpperBody, setIsLoadingUpperBody] = useState(false);
  const [isLoadingLowerBody, setIsLoadingLowerBody] = useState(false);
  const [generatedRobots, setGeneratedRobots] = useState<GeneratedRobot[]>([]);
  // 用于显示的3个位置（循环更新，FIFO）
  const [upperBodyParts, setUpperBodyParts] = useState<(RobotPart | null)[]>([null, null, null]);
  const [lowerBodyParts, setLowerBodyParts] = useState<(RobotPart | null)[]>([null, null, null]);
  // 保存所有生成的数据
  const [allUpperBodyParts, setAllUpperBodyParts] = useState<RobotPart[]>([]);
  const [allLowerBodyParts, setAllLowerBodyParts] = useState<RobotPart[]>([]);
  // 控制阶段1部件的隐藏状态
  const [hideUpperBodyStage1, setHideUpperBodyStage1] = useState(false);
  const [hideLowerBodyStage1, setHideLowerBodyStage1] = useState(false);
  // 控制阶段2部件的隐藏状态
  const [hideUpperBodyStage2, setHideUpperBodyStage2] = useState(false);
  const [hideLowerBodyStage2, setHideLowerBodyStage2] = useState(false);
  const [selectedUpperPart, setSelectedUpperPart] = useState<string | null>(null);
  const [selectedLowerPart, setSelectedLowerPart] = useState<string | null>(null);
  const [upperBodyDataCache, setUpperBodyDataCache] = useState<RobotDataCache>({});
  const [lowerBodyDataCache, setLowerBodyDataCache] = useState<RobotDataCache>({});
  const [imageCache, setImageCache] = useState<ImageCache>({}); // 图片缓存
  const [combinedRobot, setCombinedRobot] = useState<GeneratedRobot | null>(null);
  const [generationStage, setGenerationStage] = useState<'idle' | 'stage1' | 'stage2'>('idle');
  const [upperBodyStage, setUpperBodyStage] = useState<'idle' | 'stage1' | 'stage2'>('idle');
  const [lowerBodyStage, setLowerBodyStage] = useState<'idle' | 'stage1' | 'stage2'>('idle');
  const [partParams, setPartParams] = useState<PartModeParams>({
    upperBody: { dof: '5', payload: 3, weight: 6.5, workRadius: 1.1 },
    lowerBody: { dof: '5', payload: 27.5, weight: 37.5, speed: 3 }
  });
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [operationMode, setOperationMode] = useState<'generate' | 'combine' | null>(null);
  const [isParamsPanelCollapsed, setIsParamsPanelCollapsed] = useState(false);
  const [upperBodyParamHistory, setUpperBodyParamHistory] = useState<ParameterHistory[]>([]);
  const [lowerBodyParamHistory, setLowerBodyParamHistory] = useState<ParameterHistory[]>([]);
  
  // 拼接相关状态
  const [selectedUpperBodyForAssemble, setSelectedUpperBodyForAssemble] = useState<RobotPart | null>(null);
  const [selectedLowerBodyForAssemble, setSelectedLowerBodyForAssemble] = useState<RobotPart | null>(null);
  const [assembledRobot, setAssembledRobot] = useState<RobotPart | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  
  // Robot viewer states
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerRobotId, setViewerRobotId] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const mqttClientRef = useRef<MqttClient | null>(null);
  const upperBodyRobotUnsubscribeRef = useRef<(() => void) | null>(null); // 上半身阶段1订阅
  const lowerBodyRobotUnsubscribeRef = useRef<(() => void) | null>(null); // 下半身阶段1订阅
  const combineRobotUnsubscribeRef = useRef<(() => void) | null>(null); // 整机组合模式订阅
  const upperBodyRobotIdsUnsubscribeRef = useRef<(() => void) | null>(null);
  const lowerBodyRobotIdsUnsubscribeRef = useRef<(() => void) | null>(null);
  const upperBodyCounterRef = useRef<number>(0);
  const lowerBodyCounterRef = useRef<number>(0);
  // 追踪阶段1正在进行的图片获取Promise
  const upperBodyStage1PromisesRef = useRef<Promise<void>[]>([]);
  const lowerBodyStage1PromisesRef = useRef<Promise<void>[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 初始化 MQTT 连接
  useEffect(() => {
    if (open && isPartMode && !API_CONFIG.localMode) {
      mqttClientRef.current = mqttApi.getClient();
    }
    return () => {
      // 清理订阅
      if (upperBodyRobotUnsubscribeRef.current) {
        upperBodyRobotUnsubscribeRef.current();
        upperBodyRobotUnsubscribeRef.current = null;
      }
      if (lowerBodyRobotUnsubscribeRef.current) {
        lowerBodyRobotUnsubscribeRef.current();
        lowerBodyRobotUnsubscribeRef.current = null;
      }
      if (combineRobotUnsubscribeRef.current) {
        combineRobotUnsubscribeRef.current();
        combineRobotUnsubscribeRef.current = null;
      }
      if (upperBodyRobotIdsUnsubscribeRef.current) {
        upperBodyRobotIdsUnsubscribeRef.current();
        upperBodyRobotIdsUnsubscribeRef.current = null;
      }
      if (lowerBodyRobotIdsUnsubscribeRef.current) {
        lowerBodyRobotIdsUnsubscribeRef.current();
        lowerBodyRobotIdsUnsubscribeRef.current = null;
      }
      // 清理所有缓存的 blob URL
      setImageCache(prevCache => {
        Object.values(prevCache).forEach(url => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
        });
        return {};
      });
    };
  }, [open, isPartMode]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: inputMessage };
    setMessages(prev => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    try {
      // TODO: 接入真实的AI对话API
      // 模拟AI回复
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const aiResponse: Message = {
        role: "assistant",
        content: "我理解您的需求。正在为您生成3个机器人设计方案..."
      };
      setMessages(prev => [...prev, aiResponse]);

      // 模拟生成3个机器人
      await new Promise(resolve => setTimeout(resolve, 2000));
      const newRobots: GeneratedRobot[] = [
        {
          id: `robot-${Date.now()}-1`,
          name: "AI设计-001",
          imageUrl: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=400&h=400&fit=crop",
          description: "适用于加油作业的轮式机器人"
        },
        {
          id: `robot-${Date.now()}-2`,
          name: "AI设计-002",
          imageUrl: "https://images.unsplash.com/photo-1563207153-f403bf289096?w=400&h=400&fit=crop",
          description: "适用于检测作业的履带机器人"
        },
        {
          id: `robot-${Date.now()}-3`,
          name: "AI设计-003",
          imageUrl: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=400&fit=crop",
          description: "适用于装配作业的固定机器人"
        }
      ];
      setGeneratedRobots(newRobots);

      const successMessage: Message = {
        role: "assistant",
        content: "已为您生成3个机器人设计方案，请查看右侧展示区。您可以点击保存按钮将喜欢的设计保存到机器人列表。"
      };
      setMessages(prev => [...prev, successMessage]);
    } catch (error) {
      toast.error("消息发送失败");
      console.error("Send message failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveRobot = async (robot: GeneratedRobot) => {
    try {
      onSave?.({
        ...robot,
        upperBody: partParams.upperBody,
        lowerBody: partParams.lowerBody,
      });
      toast.success(`机器人 ${robot.name} 已保存到列表`);
      
      // 模拟保存成功的消息
      const saveMessage: Message = {
        role: "assistant",
        content: `已成功保存机器人 ${robot.name} 到您的机器人列表。`
      };
      setMessages(prev => [...prev, saveMessage]);
    } catch (error) {
      toast.error("保存失败");
      console.error("Save robot failed:", error);
    }
  };

  // 通用图片获取函数：从API获取图片并缓存
  const fetchAndCacheImage = async (robotId: string, xmlPath: string): Promise<string> => {
    // 检查缓存
    if (imageCache[robotId]) {
      console.log(`使用缓存的图片: ${robotId}`);
      return imageCache[robotId];
    }

    try {
      const modelPath = xmlPath;
      const url = robotImageUrl.getImage(modelPath);
      console.log(`获取图片: ${robotId}, URL: ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      // 缓存图片
      setImageCache(prev => ({
        ...prev,
        [robotId]: blobUrl
      }));
      
      console.log(`图片获取成功并缓存: ${robotId}`);
      return blobUrl;
    } catch (error) {
      console.error(`获取图片失败 ${robotId}:`, error);
      throw error;
    }
  };

  const handleGenerateLocalParts = async (type: 'upper' | 'lower') => {
    const isUpper = type === 'upper';
    isUpper ? setIsLoadingUpperBody(true) : setIsLoadingLowerBody(true);
    setSelectedUpperBodyForAssemble(null);
    setSelectedLowerBodyForAssemble(null);
    setAssembledRobot(null);
    setOperationMode('generate');
    setGenerationStage('stage2');
    setIsParamsPanelCollapsed(true);

    try {
      const response = await robotDesignApi.generate({
        type,
        params: isUpper ? partParams.upperBody : partParams.lowerBody,
      });
      const rawParts = response.result?.parts || [];
      const parts: RobotPart[] = rawParts.map((rawPart: any) => {
        const values = isUpper ? rawPart.arm_parameters : rawPart.base_parameters;
        return {
          id: rawPart.robot_id,
          name: rawPart.name,
          imageUrl: robotImageUrl.getImage(rawPart.xml_path),
          type,
          length: isUpper ? values?.length : undefined,
          velocity: isUpper ? undefined : values?.velocity,
          mass: values?.mass,
          load: values?.load,
          dofs: values?.dofs,
          xmlPath: rawPart.xml_path,
        };
      });
      const history: ParameterHistory[] = parts.map((part, index) => ({
        index: index + 1,
        payload: part.load || 0,
        weight: part.mass || 0,
        ...(isUpper ? { workRadius: part.length } : { speed: part.velocity }),
      }));

      if (isUpper) {
        setUpperBodyParts(parts);
        setAllUpperBodyParts(parts);
        setUpperBodyParamHistory(history);
        setUpperBodyStage('stage2');
        setHideUpperBodyStage1(false);
        setHideUpperBodyStage2(false);
      } else {
        setLowerBodyParts(parts);
        setAllLowerBodyParts(parts);
        setLowerBodyParamHistory(history);
        setLowerBodyStage('stage2');
        setHideLowerBodyStage1(false);
        setHideLowerBodyStage2(false);
      }

      toast.success(`${isUpper ? '上半身' : '下半身'}部件生成完成（本地模式）`);
    } catch (error) {
      console.error("Local robot part generation failed:", error);
      toast.error("本地部件生成失败");
    } finally {
      isUpper ? setIsLoadingUpperBody(false) : setIsLoadingLowerBody(false);
    }
  };

  const handleGenerateUpperBody = async () => {
    if (API_CONFIG.localMode) {
      await handleGenerateLocalParts('upper');
      return;
    }

    if (!mqttClientRef.current) {
      toast.error("MQTT未连接");
      return;
    }

    // 重置拼接相关状态
    setSelectedUpperBodyForAssemble(null);
    setSelectedLowerBodyForAssemble(null);
    setAssembledRobot(null);

    // 立即清空阶段1和阶段2的显示和数据
    setUpperBodyParts([]);  // 清空展示的图片（阶段1和阶段2共用）
    setAllUpperBodyParts([]);
    setUpperBodyDataCache({});
    setUpperBodyParamHistory([]); // 清空参数历史
    setUpperBodyStage('stage1');

    //调整阶段1的展示内容
    setHideUpperBodyStage1(false);
    setHideLowerBodyStage1(true);

    // 先取消下半身的阶段1订阅（如果存在）
    if (lowerBodyRobotUnsubscribeRef.current) {
      console.log('取消下半身阶段1订阅，避免干扰上半身生成');
      lowerBodyRobotUnsubscribeRef.current();
      lowerBodyRobotUnsubscribeRef.current = null;
    }

    // 根据当前展示区状态处理
    const hasUpperBody = upperBodyStage === 'stage2' && upperBodyParts.length === 12;
    const hasLowerBody = lowerBodyStage === 'stage2' && lowerBodyParts.length === 12;

    if (hasUpperBody && !hasLowerBody) {
      // 情况2: 已有12个上半身，隐藏并删除缓存
      setHideUpperBodyStage2(true);
      setImageCache(prev => {
        const newCache = { ...prev };
        upperBodyParts.forEach(part => {
          if (part && newCache[part.id]) {
            URL.revokeObjectURL(newCache[part.id]);
            delete newCache[part.id];
          }
        });
        return newCache;
      });
    } else if (!hasUpperBody && hasLowerBody) {
      // 情况3: 已有12个下半身，生成过程中隐藏
      setHideLowerBodyStage2(true);
    } else if (hasUpperBody && hasLowerBody) {
      // 情况4: 已有24个部件，隐藏并删除上半身缓存
      setHideUpperBodyStage2(true);
      setHideLowerBodyStage2(true);
      setImageCache(prev => {
        const newCache = { ...prev };
        upperBodyParts.forEach(part => {
          if (part && newCache[part.id]) {
            URL.revokeObjectURL(newCache[part.id]);
            delete newCache[part.id];
          }
        });
        return newCache;
      });
    }

    // 清除上次阶段1的图片缓存
    setImageCache(prev => {
      const newCache = { ...prev };
      allUpperBodyParts.forEach(part => {
        if (newCache[part.id]) {
          URL.revokeObjectURL(newCache[part.id]);
          delete newCache[part.id];
        }
      });
      return newCache;
    });
    
    setIsLoadingUpperBody(true);
    setAllUpperBodyParts([]); // 清空阶段1的所有数据
    setSelectedUpperPart(null);
    setUpperBodyStage('stage1');
    setOperationMode('generate'); // 设置为生成模式
    setIsParamsPanelCollapsed(true); // 收起参数面板
    setUpperBodyParamHistory([]); // 清空参数历史
    upperBodyCounterRef.current = 0; // 重置计数器
    upperBodyStage1PromisesRef.current = []; // 清空Promise追踪数组

    try {
      const client = mqttClientRef.current;
      
      // 订阅阶段一图片，传入Promise追踪ref
      upperBodyRobotUnsubscribeRef.current = subscribeRobotImages(client, (imageData) => {
        console.log('收到上半身图片数据:', imageData);
        
        // 保存到缓存
        setUpperBodyDataCache(prev => ({
          ...prev,
          [imageData.robot_id]: {
            imageUrl: imageData.url,
            length: imageData.arm_parameters?.length, // 上半身使用工作半径
            mass: imageData.arm_parameters?.mass,
            load: imageData.arm_parameters?.load,
            dofs: imageData.arm_parameters?.dofs,
            xmlPath: imageData.xml_path
          }
        }));

        // 添加参数历史记录
        setUpperBodyParamHistory(prev => {
          const newHistory = [...prev, {
            index: prev.length + 1,
            payload: imageData.arm_parameters?.load || 0,
            weight: imageData.arm_parameters?.mass || 0,
            workRadius: imageData.arm_parameters?.length || 0,
          }];
          return newHistory.slice(-20); // 保留最近20条记录
        });
        
        const upperPart: RobotPart = {
          id: imageData.robot_id,
          name: `上半身-${imageData.robot_id}`,
          imageUrl: imageData.url || imageData,
          type: 'upper',
          length: imageData.arm_parameters?.length, // 上半身使用工作半径
          mass: imageData.arm_parameters?.mass,
          load: imageData.arm_parameters?.load,
          dofs: imageData.arm_parameters?.dofs,
          xmlPath: imageData.xml_path
        };
        
        // 保存到完整列表中
        setAllUpperBodyParts(prev => [...prev, upperPart]);
        
        // 按FIFO方式更新显示位置（3个位置循环）
        const displayIndex = upperBodyCounterRef.current % 3;
        upperBodyCounterRef.current += 1;
        
        setUpperBodyParts(displayParts => {
          const newDisplayParts = [...displayParts];
          newDisplayParts[displayIndex] = upperPart;
          return newDisplayParts;
        });
      }, 'generate', upperBodyStage1PromisesRef);

      // 先取消下半身的阶段2订阅（如果存在）
      if (lowerBodyRobotIdsUnsubscribeRef.current) {
        lowerBodyRobotIdsUnsubscribeRef.current();
        lowerBodyRobotIdsUnsubscribeRef.current = null;
      }
      
      // 订阅阶段二图片列表
      upperBodyRobotIdsUnsubscribeRef.current = subscribeRobotIds(client, async (robotIds) => {
        console.log('收到上半身阶段2 ID列表:', robotIds);
        if (Array.isArray(robotIds) && robotIds.length === 12) {
          // 立即取消阶段1的订阅，停止接收新数据
          if (upperBodyRobotUnsubscribeRef.current) {
            console.log('取消上半身阶段1订阅');
            upperBodyRobotUnsubscribeRef.current();
            upperBodyRobotUnsubscribeRef.current = null;
          }
          
          // 等待所有阶段1的图片获取完成
          console.log(`等待上半身阶段1所有图片获取完成，当前待完成数量: ${upperBodyStage1PromisesRef.current.length}`);
          await Promise.all(upperBodyStage1PromisesRef.current);
          console.log('上半身阶段1图片全部获取完成，开始阶段2');
          upperBodyStage1PromisesRef.current = []; // 清空Promise数组
          
          setUpperBodyStage('stage2');
          setHideUpperBodyStage1(true);
          
          // 去重处理：使用Set确保ID唯一性
          const uniqueRobotIds = Array.from(new Set(robotIds));
          console.log('去重后的上半身ID列表:', uniqueRobotIds);
          
          // 从阶段1的完整列表中查找对应ID的数据
          setAllUpperBodyParts(prevAll => {
            const upperParts: RobotPart[] = uniqueRobotIds.map((id) => {
              const foundPart = prevAll.find(part => part.id === id);
              if (foundPart) {
                return foundPart;
              }
              // 如果在完整列表中找不到，尝试从缓存中获取
              const cachedData = upperBodyDataCache[id];
              return {
                id: id,
                name: `上半身-${id}`,
                imageUrl: cachedData?.imageUrl || '',
                type: 'upper' as const,
                length: cachedData?.length, // 上半身使用工作半径
                mass: cachedData?.mass,
                load: cachedData?.load,
                dofs: cachedData?.dofs,
                xmlPath: cachedData?.xmlPath
              };
            });
            setUpperBodyParts(upperParts);
            // 生成完成后，显示所有隐藏的部件
            setHideUpperBodyStage2(false);
            setHideLowerBodyStage2(false);
            toast.success("上半身部件生成完成");
            setIsLoadingUpperBody(false);
            return prevAll; // 保持原有的完整列表不变
          });
        }
      });

      // 发送上半身设计请求
      const params = {
        N: parseInt(partParams.upperBody.dof),
        payload: partParams.upperBody.payload,
        weight_limit: partParams.upperBody.weight,
        total_len: partParams.upperBody.workRadius
      };

      client.publish(
        MQTT_TOPICS.designUpperBody,
        JSON.stringify(params),
        { qos: 1 },
        (error) => {
          if (error) {
            console.error('发送上半身设计请求失败:', error);
            toast.error("发送请求失败");
            setIsLoadingUpperBody(false);
          } else {
            console.log('发送上半身设计请求成功:', params);
            toast.info("上半身设计请求已发送，等待生成...");
          }
        }
      );
    } catch (error) {
      toast.error("上半身生成失败");
      console.error("Generate upper body failed:", error);
      setIsLoadingUpperBody(false);
    }
  };

  const subscribeRobotImages = (
    client: MqttClient, 
    callback: (imageData: any) => void, 
    mode: 'generate' | 'combine' | null,
    promisesRef?: React.MutableRefObject<Promise<void>[]>
  ) => {
    client.subscribe(MQTT_TOPICS.robotImage, { qos: 1 }, (error) => {
      if (error) {
        console.error('订阅机器人图片失败:', error);
      } else {
        console.log('订阅机器人图片成功');
      }
    });

    const messageHandler = async (topic: string, message: Buffer) => {
      if (topic === MQTT_TOPICS.robotImage) {
        try {
          const data = JSON.parse(message.toString());
          console.log(`收到机器人图片数据，当前操作模式: ${mode}`, data);
          
          // 根据操作模式处理数据
          if (mode === 'generate') {
            // 生成部件模式：获取图片并调用callback添加到部件列表
            const fetchPromise = (async () => {
              try {
                const imageUrl = await fetchAndCacheImage(data.robot_id, data.xml_path);
                const imageDataWithUrl = {
                  ...data,
                  url: imageUrl,
                  arm_parameters: data.arm_parameters,
                  xml_path: data.xml_path
                };
                callback(imageDataWithUrl);
              } catch (error) {
                console.error('获取机器人图片失败:', error);
                toast.error('获取机器人图片失败');
              }
            })();
            
            // 如果提供了promisesRef，将Promise添加到追踪数组
            if (promisesRef) {
              promisesRef.current.push(fetchPromise);
            }
          } else if (mode === 'combine') {
            // 组合部件模式：获取图片并显示在预览对话框
            try {
              const imageUrl = await fetchAndCacheImage(data.robot_id, data.xml_path);
              const combined: GeneratedRobot = {
                id: data.robot_id || `combined-${Date.now()}`,
                name: data.name || "组合机器人",
                imageUrl: imageUrl,
                description: data.description || "组合机器人"
              };

              setCombinedRobot(combined);
              setPreviewDialogOpen(true);
              toast.success("部件组合成功");
              setOperationMode(null); // 重置模式
            } catch (error) {
              console.error('获取机器人图片失败:', error);
              toast.error('获取机器人图片失败');
            }
          }
        } catch (error) {
          console.error('解析机器人图片数据失败:', error);
        }
      }
    };

    client.on('message', messageHandler);

    return () => {
      client.off('message', messageHandler);
      client.unsubscribe(MQTT_TOPICS.robotImage);
    };
  };

  const subscribeRobotIds = (client: MqttClient, callback: (robotIds: any[]) => void) => {
    client.subscribe(MQTT_TOPICS.robotIds, { qos: 1 }, (error) => {
      if (error) {
        console.error('订阅机器人ID列表失败:', error);
      } else {
        console.log('订阅机器人ID列表成功');
      }
    });

    const messageHandler = (topic: string, message: Buffer) => {
      if (topic === MQTT_TOPICS.robotIds) {
        try {
          const data = JSON.parse(message.toString());
          console.log('收到机器人ID列表:', data);
          if (Array.isArray(data)) {
            callback(data);
          }
        } catch (error) {
          console.error('解析机器人ID列表数据失败:', error);
        }
      }
    };

    client.on('message', messageHandler);

    return () => {
      client.off('message', messageHandler);
      client.unsubscribe(MQTT_TOPICS.robotIds);
    };
  };

  const handleGenerateLowerBody = async () => {
    if (API_CONFIG.localMode) {
      await handleGenerateLocalParts('lower');
      return;
    }

    if (!mqttClientRef.current) {
      toast.error("MQTT未连接");
      return;
    }

    // 重置拼接相关状态
    setSelectedUpperBodyForAssemble(null);
    setSelectedLowerBodyForAssemble(null);
    setAssembledRobot(null);

    // 立即清空阶段1和阶段2的显示和数据
    setLowerBodyParts([]);  // 清空展示的图片（阶段1和阶段2共用）
    setAllLowerBodyParts([]);
    setLowerBodyDataCache({});
    setLowerBodyParamHistory([]); // 清空参数历史
    setLowerBodyStage('stage1');

    //调整阶段1的展示内容
    setHideUpperBodyStage1(true);
    setHideLowerBodyStage1(false);

    // 先取消上半身的阶段1订阅（如果存在）
    if (upperBodyRobotUnsubscribeRef.current) {
      console.log('取消上半身阶段1订阅，避免干扰下半身生成');
      upperBodyRobotUnsubscribeRef.current();
      upperBodyRobotUnsubscribeRef.current = null;
    }


    // 根据当前展示区状态处理
    const hasUpperBody = upperBodyStage === 'stage2' && upperBodyParts.length === 12;
    const hasLowerBody = lowerBodyStage === 'stage2' && lowerBodyParts.length === 12;

    console.log(upperBodyStage)
    console.log(lowerBodyStage)
    console.log(hasUpperBody)
    console.log(hasLowerBody)

    if (hasLowerBody && !hasUpperBody) {
      // 情况2: 已有12个下半身，隐藏并删除缓存
      setHideLowerBodyStage2(true);
      setImageCache(prev => {
        const newCache = { ...prev };
        lowerBodyParts.forEach(part => {
          if (part && newCache[part.id]) {
            URL.revokeObjectURL(newCache[part.id]);
            delete newCache[part.id];
          }
        });
        return newCache;
      });
    } else if (hasUpperBody && !hasLowerBody) {
      // 情况3: 已有12个上半身，生成过程中隐藏
      setHideUpperBodyStage2(true);
    } else if (hasUpperBody && hasLowerBody) {
      // 情况4: 已有24个部件，隐藏并删除下半身缓存
      setHideUpperBodyStage2(true);
      setHideLowerBodyStage2(true);
      setImageCache(prev => {
        const newCache = { ...prev };
        lowerBodyParts.forEach(part => {
          if (part && newCache[part.id]) {
            URL.revokeObjectURL(newCache[part.id]);
            delete newCache[part.id];
          }
        });
        return newCache;
      });
    }

    // 清除上次阶段1的图片缓存
    setImageCache(prev => {
      const newCache = { ...prev };
      allLowerBodyParts.forEach(part => {
        if (newCache[part.id]) {
          URL.revokeObjectURL(newCache[part.id]);
          delete newCache[part.id];
        }
      });
      return newCache;
    });
    
    setIsLoadingLowerBody(true);
    setAllLowerBodyParts([]); // 清空阶段1的所有数据
    setSelectedLowerPart(null);
    setLowerBodyStage('stage1');
    setOperationMode('generate'); // 设置为生成模式
    setIsParamsPanelCollapsed(true); // 收起参数面板
    setLowerBodyParamHistory([]); // 清空参数历史
    lowerBodyCounterRef.current = 0; // 重置计数器
    lowerBodyStage1PromisesRef.current = []; // 清空Promise追踪数组

    try {
      const client = mqttClientRef.current;
      
      // 订阅阶段一图片，传入Promise追踪ref
      lowerBodyRobotUnsubscribeRef.current = subscribeRobotImages(client, (imageData) => {
        console.log('收到下半身图片数据:', imageData);
        
        // 保存到缓存
        setLowerBodyDataCache(prev => ({
          ...prev,
          [imageData.robot_id]: {
            imageUrl: imageData.url,
            velocity: imageData.arm_parameters?.velocity,
            mass: imageData.arm_parameters?.mass,
            load: imageData.arm_parameters?.load,
            dofs: imageData.arm_parameters?.dofs,
            xmlPath: imageData.xml_path
          }
        }));

        // 添加参数历史记录
        setLowerBodyParamHistory(prev => {
          const newHistory = [...prev, {
            index: prev.length + 1,
            payload: imageData.arm_parameters?.load || 0,
            weight: imageData.arm_parameters?.mass || 0,
            speed: imageData.arm_parameters?.velocity || 0,
          }];
          return newHistory.slice(-20); // 保留最近20条记录
        });
        
        const lowerPart: RobotPart = {
          id: imageData.robot_id,
          name: `下半身-${imageData.robot_id}`,
          imageUrl: imageData.url || imageData,
          type: 'lower',
          velocity: imageData.arm_parameters?.velocity,
          mass: imageData.arm_parameters?.mass,
          load: imageData.arm_parameters?.load,
          dofs: imageData.arm_parameters?.dofs,
          xmlPath: imageData.xml_path
        };
        
        // 保存到完整列表中
        setAllLowerBodyParts(prev => [...prev, lowerPart]);
        
        // 按FIFO方式更新显示位置（3个位置循环）
        const displayIndex = lowerBodyCounterRef.current % 3;
        lowerBodyCounterRef.current += 1;
        
        setLowerBodyParts(displayParts => {
          const newDisplayParts = [...displayParts];
          newDisplayParts[displayIndex] = lowerPart;
          return newDisplayParts;
        });
      }, 'generate', lowerBodyStage1PromisesRef);

      // 先取消上半身的阶段2订阅（如果存在）
      if (upperBodyRobotIdsUnsubscribeRef.current) {
        upperBodyRobotIdsUnsubscribeRef.current();
        upperBodyRobotIdsUnsubscribeRef.current = null;
      }
      
      // 订阅阶段二图片列表
      lowerBodyRobotIdsUnsubscribeRef.current = subscribeRobotIds(client, async (robotIds) => {
        console.log('收到下半身阶段2 ID列表:', robotIds);
        if (Array.isArray(robotIds) && robotIds.length === 12) {
          // 立即取消阶段1的订阅，停止接收新数据
          if (lowerBodyRobotUnsubscribeRef.current) {
            console.log('取消下半身阶段1订阅');
            lowerBodyRobotUnsubscribeRef.current();
            lowerBodyRobotUnsubscribeRef.current = null;
          }
          
          // 等待所有阶段1的图片获取完成
          console.log(`等待下半身阶段1所有图片获取完成，当前待完成数量: ${lowerBodyStage1PromisesRef.current.length}`);
          await Promise.all(lowerBodyStage1PromisesRef.current);
          console.log('下半身阶段1图片全部获取完成，开始阶段2');
          lowerBodyStage1PromisesRef.current = []; // 清空Promise数组
          
          setLowerBodyStage('stage2');
          setHideLowerBodyStage1(true);
          
          // 去重处理：使用Set确保ID唯一性
          const uniqueRobotIds = Array.from(new Set(robotIds));
          console.log('去重后的下半身ID列表:', uniqueRobotIds);
          
          // 从阶段1的完整列表中查找对应ID的数据
          setAllLowerBodyParts(prevAll => {
            const lowerParts: RobotPart[] = uniqueRobotIds.map((id) => {
              const foundPart = prevAll.find(part => part.id === id);
              if (foundPart) {
                return foundPart;
              }
              // 如果在完整列表中找不到，尝试从缓存中获取
              const cachedData = lowerBodyDataCache[id];
              return {
                id: id,
                name: `下半身-${id}`,
                imageUrl: cachedData?.imageUrl || '',
                type: 'lower' as const,
                velocity: cachedData?.velocity,
                mass: cachedData?.mass,
                load: cachedData?.load,
                dofs: cachedData?.dofs,
                xmlPath: cachedData?.xmlPath
              };
            });
            setLowerBodyParts(lowerParts);
            // 生成完成后，显示所有隐藏的部件
            setHideUpperBodyStage2(false);
            setHideLowerBodyStage2(false);
            toast.success("下半身部件生成完成");
            setIsLoadingLowerBody(false);
            return prevAll; // 保持原有的完整列表不变
          });
        }
      });

      // 发送下半身设计请求
      const params = {
        N: parseInt(partParams.lowerBody.dof),
        payload: partParams.lowerBody.payload,
        weight_limit: partParams.lowerBody.weight,
        velocity: partParams.lowerBody.speed
      };

      client.publish(
        MQTT_TOPICS.designLowerBody,
        JSON.stringify(params),
        { qos: 1 },
        (error) => {
          if (error) {
            console.error('发送下半身设计请求失败:', error);
            toast.error("发送请求失败");
            setIsLoadingLowerBody(false);
          } else {
            console.log('发送下半身设计请求成功:', params);
            toast.info("下半身设计请求已发送，等待生成...");
          }
        }
      );
    } catch (error) {
      toast.error("下半身生成失败");
      console.error("Generate lower body failed:", error);
      setIsLoadingLowerBody(false);
    }
  };

  const handleCombineParts = () => {
    if (!selectedUpperPart || !selectedLowerPart) {
      toast.error("请选择上半身和下半身部件");
      return;
    }

    if (API_CONFIG.localMode) {
      setOperationMode('combine');
      robotDesignApi.assemble({
        up_id: selectedUpperPart,
        down_id: selectedLowerPart,
      }).then((response) => {
        const robot = response.result;
        setCombinedRobot({
          id: robot.robot_id,
          name: robot.name,
          imageUrl: robotImageUrl.getImage(robot.xml_path),
          description: robot.description,
        });
        setPreviewDialogOpen(true);
        toast.success("机器人组合完成（本地模式）");
      }).catch((error) => {
        console.error("Local combine failed:", error);
        toast.error("本地组合失败");
      });
      return;
    }

    const client = mqttClientRef.current;
    if (!client || !client.connected) {
      toast.error("MQTT未连接，无法组合部件");
      return;
    }

    try {
      setOperationMode('combine'); // 设置为组合模式
      
      // 发送组合消息
      const assembleMessage = {
        up_id: selectedUpperPart,
        down_id: selectedLowerPart
      };

      console.log('发送组合请求:', assembleMessage);
      client.publish(
        MQTT_TOPICS.assembleRobot,
        JSON.stringify(assembleMessage),
        { qos: 1 },
        (error) => {
          if (error) {
            console.error('组合消息发送失败:', error);
            toast.error("组合请求发送失败");
            setOperationMode(null);
            return;
          }
          console.log('组合消息发送成功');
          toast.info("正在组合机器人...");
        }
      );

      // 订阅机器人图片主题（组合模式下会自动显示在预览对话框）
      if (!combineRobotUnsubscribeRef.current) {
        combineRobotUnsubscribeRef.current = subscribeRobotImages(client, () => {
          // 在组合模式下，callback不会被调用，数据会在subscribeRobotImages内部处理
        }, 'combine');
      }

    } catch (error) {
      toast.error("组合部件失败");
      console.error("Combine parts failed:", error);
      setOperationMode(null);
    }
  };

  const handleSaveCombinedRobot = async () => {
    if (!combinedRobot) return;
    
    try {
      onSave?.({
        ...combinedRobot,
        upperBody: partParams.upperBody,
        lowerBody: partParams.lowerBody,
      });
      toast.success(`组合机器人已保存到列表`);
      // 重置状态
      setSelectedUpperPart(null);
      setSelectedLowerPart(null);
      setCombinedRobot(null);
      setPreviewDialogOpen(false);
    } catch (error) {
      toast.error("保存失败");
      console.error("Save combined robot failed:", error);
    }
  };

  // 处理24个部件时的拼接逻辑
  const handleAssembleRobot = async () => {
    if (!selectedUpperBodyForAssemble || !selectedLowerBodyForAssemble) {
      toast.error("请选择一个上半身和一个下半身部件");
      return;
    }

    if (API_CONFIG.localMode) {
      setIsAssembling(true);
      try {
        const response = await robotDesignApi.assemble({
          up_id: selectedUpperBodyForAssemble.id,
          down_id: selectedLowerBodyForAssemble.id,
        });
        const robotData = response.result;
        setAssembledRobot({
          id: robotData.robot_id,
          name: robotData.name,
          imageUrl: robotImageUrl.getImage(robotData.xml_path),
          type: 'upper',
          length: selectedUpperBodyForAssemble.length,
          velocity: selectedLowerBodyForAssemble.velocity,
          mass: (selectedUpperBodyForAssemble.mass || 0) + (selectedLowerBodyForAssemble.mass || 0),
          load: (selectedUpperBodyForAssemble.load || 0) + (selectedLowerBodyForAssemble.load || 0),
          dofs: (selectedUpperBodyForAssemble.dofs || 0) + (selectedLowerBodyForAssemble.dofs || 0),
          xmlPath: robotData.xml_path,
        });
        toast.success("机器人拼接成功（本地模式）");
      } catch (error) {
        console.error("Local assembly failed:", error);
        toast.error("本地拼接失败");
      } finally {
        setIsAssembling(false);
      }
      return;
    }

    const client = mqttClientRef.current;
    if (!client || !client.connected) {
      toast.error("MQTT未连接");
      return;
    }

    setIsAssembling(true);
    
    try {
      // 先取消之前的订阅，避免干扰
      if (upperBodyRobotUnsubscribeRef.current) {
        console.log('取消上半身阶段1订阅，准备拼接');
        upperBodyRobotUnsubscribeRef.current();
        upperBodyRobotUnsubscribeRef.current = null;
      }
      if (lowerBodyRobotUnsubscribeRef.current) {
        console.log('取消下半身阶段1订阅，准备拼接');
        lowerBodyRobotUnsubscribeRef.current();
        lowerBodyRobotUnsubscribeRef.current = null;
      }

      // 订阅拼接结果（监听robotImage topic）
      const assemblePromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("拼接超时"));
        }, 30000);

        client.subscribe(MQTT_TOPICS.robotImage, { qos: 1 }, (err) => {
          if (err) {
            clearTimeout(timeout);
            reject(err);
            return;
          }

          const messageHandler = async (topic: string, message: Buffer) => {
            if (topic === MQTT_TOPICS.robotImage) {
              clearTimeout(timeout);
              try {
                const robotData = JSON.parse(message.toString());
                console.log('收到拼接机器人数据:', robotData);
                client.off('message', messageHandler);
                client.unsubscribe(MQTT_TOPICS.robotImage);
                resolve(robotData);
              } catch (error) {
                reject(error);
              }
            }
          };

          client.on('message', messageHandler);
        });
      });

      // 发送拼接请求到assembleRobot topic
      const assembleMessage = {
        up_id: selectedUpperBodyForAssemble.id,
        down_id: selectedLowerBodyForAssemble.id,
      };

      console.log('发送拼接请求:', assembleMessage);
      client.publish(
        MQTT_TOPICS.assembleRobot,
        JSON.stringify(assembleMessage),
        { qos: 1 }
      );

      // 等待拼接结果
      const robotData = await assemblePromise;

      // 获取拼接后的机器人图片
      if (robotData.xml_path) {
        console.log('开始获取拼接机器人图片，xml_path:', robotData.xml_path);
        const imageUrl = await fetchAndCacheImage(robotData.robot_id, robotData.xml_path);
        
        setAssembledRobot({
          id: robotData.robot_id,
          name: `组合机器人-${robotData.robot_id}`,
          imageUrl,
          type: 'upper', // 类型设为upper，但包含上下半身参数
          // 上半身参数
          length: selectedUpperBodyForAssemble.length,
          // 下半身参数
          velocity: selectedLowerBodyForAssemble.velocity,
          // 共同参数（相加）
          mass: (selectedUpperBodyForAssemble.mass || 0) + (selectedLowerBodyForAssemble.mass || 0),
          load: (selectedUpperBodyForAssemble.load || 0) + (selectedLowerBodyForAssemble.load || 0),
          dofs: (selectedUpperBodyForAssemble.dofs || 0) + (selectedLowerBodyForAssemble.dofs || 0),
          xmlPath: robotData.xml_path,
        });

        toast.success("机器人拼接成功");
      }
    } catch (error) {
      console.error('拼接机器人失败:', error);
      toast.error(error instanceof Error ? error.message : "拼接机器人时发生错误");
    } finally {
      setIsAssembling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[98vh]">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>AI-Design</DialogTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="mode-switch">{isPartMode ? '部件模式' : '整机模式'}</Label>
            <Switch
              id="mode-switch"
              checked={isPartMode}
              onCheckedChange={setIsPartMode}
            />
          </div>
        </DialogHeader>

        {!isPartMode ? (
          // 整机模式
          <ResizablePanelGroup direction="horizontal" className="h-[calc(98vh-100px)]">
            {/* 左侧：对话区 */}
            <ResizablePanel defaultSize={20} minSize={20} maxSize={50}>
              <div className="flex flex-col h-[calc(98vh-120px)] pr-4">
              <h3 className="text-lg font-semibold mb-4">需求交互区</h3>
              
              {/* 消息列表 */}
              <ScrollArea className="h-[calc(98vh-220px)] pr-4 mb-4">
                <div ref={scrollRef} className="space-y-4">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg px-4 py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* 输入框 */}
              <div className="flex gap-2">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="输入您的设计需求..."
                  disabled={isLoading}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={isLoading || !inputMessage.trim()}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* 右侧：机器人展示区 */}
            <ResizablePanel defaultSize={80} minSize={50} maxSize={80}>
              <div className="flex flex-col h-[calc(98vh-120px)] pl-4">
              <h3 className="text-lg font-semibold mb-4">机器人展示区</h3>
              
              <div className="h-[calc(98vh-180px)]">
                {generatedRobots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-4 h-full">
                    {generatedRobots.map((robot) => (
                      <div
                        key={robot.id}
                        className="border rounded-lg p-3 flex flex-col bg-card h-full"
                      >
                        <div className="flex-1 rounded-md overflow-hidden bg-muted mb-2">
                          <img
                            src={robot.imageUrl}
                            alt={robot.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <h4 className="font-medium text-sm">{robot.name}</h4>
                        <Button
                          onClick={() => handleSaveRobot(robot)}
                          className="w-full mt-2"
                          variant="outline"
                          size="sm"
                        >
                          保存
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <p className="text-center">
                      请在左侧对话框中输入您的设计需求
                      <br />
                      我将为您生成3个机器人设计方案
                    </p>
                  </div>
                )}
              </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          // 部件模式
          <ResizablePanelGroup direction="horizontal" className="h-[calc(98vh-100px)]" key={isParamsPanelCollapsed ? 'collapsed' : 'expanded'}>
            {/* 左侧：参数设置区 */}
            <ResizablePanel 
              defaultSize={isParamsPanelCollapsed ? 3 : 20} 
              minSize={isParamsPanelCollapsed ? 3 : 20} 
              maxSize={isParamsPanelCollapsed ? 3 : 50}
              collapsible={false}
            >
              <div className="flex flex-col h-[calc(98vh-120px)] pr-4 relative">
                {!isParamsPanelCollapsed ? (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-foreground">参数设置</h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsParamsPanelCollapsed(true)}
                        className="h-6 w-6"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-3">
                    {/* 上半身参数 */}
                    <div className="rounded-lg border border-border bg-card p-3 space-y-3 shadow-sm">
                      <div className="flex items-center gap-2 pb-2 border-b border-border">
                        <div className="w-1 h-4 bg-primary rounded-full" />
                        <h4 className="font-semibold text-sm text-foreground">上半身</h4>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-foreground">自由度</Label>
                        <RadioGroup
                          value={partParams.upperBody.dof}
                          onValueChange={(value) => 
                            setPartParams(prev => ({
                              ...prev,
                              upperBody: { ...prev.upperBody, dof: value }
                            }))
                          }
                          className="flex gap-2"
                        >
                          <div className="flex items-center space-x-1.5 flex-1">
                            <RadioGroupItem value="5" id="upper-5" />
                            <Label htmlFor="upper-5" className="cursor-pointer text-xs">5自由度</Label>
                          </div>
                          <div className="flex items-center space-x-1.5 flex-1">
                            <RadioGroupItem value="6" id="upper-6" />
                            <Label htmlFor="upper-6" className="cursor-pointer text-xs">6自由度</Label>
                          </div>
                          <div className="flex items-center space-x-1.5 flex-1">
                            <RadioGroupItem value="7" id="upper-7" />
                            <Label htmlFor="upper-7" className="cursor-pointer text-xs">7自由度</Label>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-foreground">负载</Label>
                          <span className="text-xs font-semibold text-primary">{partParams.upperBody.payload}kg</span>
                        </div>
                        <Slider
                          value={[partParams.upperBody.payload]}
                          onValueChange={([value]) =>
                            setPartParams(prev => ({
                              ...prev,
                              upperBody: { ...prev.upperBody, payload: value }
                            }))
                          }
                          min={1}
                          max={5}
                          step={0.1}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>1kg</span>
                          <span>5kg</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-foreground">自重</Label>
                          <span className="text-xs font-semibold text-primary">{partParams.upperBody.weight}kg</span>
                        </div>
                        <Slider
                          value={[partParams.upperBody.weight]}
                          onValueChange={([value]) =>
                            setPartParams(prev => ({
                              ...prev,
                              upperBody: { ...prev.upperBody, weight: value }
                            }))
                          }
                          min={4}
                          max={9}
                          step={0.1}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>4kg</span>
                          <span>9kg</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-foreground">工作半径</Label>
                          <span className="text-xs font-semibold text-primary">{partParams.upperBody.workRadius}m</span>
                        </div>
                        <Slider
                          value={[partParams.upperBody.workRadius]}
                          onValueChange={([value]) =>
                            setPartParams(prev => ({
                              ...prev,
                              upperBody: { ...prev.upperBody, workRadius: value }
                            }))
                          }
                          min={0.7}
                          max={1.5}
                          step={0.01}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>0.7m</span>
                          <span>1.5m</span>
                        </div>
                      </div>
                      
                      <Button
                        onClick={handleGenerateUpperBody}
                        disabled={isLoadingUpperBody}
                        className="w-full mt-1 h-8 text-sm font-medium shadow-sm"
                      >
                        {isLoadingUpperBody ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            生成中...
                          </>
                        ) : (
                          "生成上半身"
                        )}
                      </Button>
                    </div>

                    {/* 下半身参数 */}
                    <div className="rounded-lg border border-border bg-card p-3 space-y-3 shadow-sm">
                      <div className="flex items-center gap-2 pb-2 border-b border-border">
                        <div className="w-1 h-4 bg-primary rounded-full" />
                        <h4 className="font-semibold text-sm text-foreground">下半身</h4>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-foreground">自由度</Label>
                        <RadioGroup
                          value={partParams.lowerBody.dof}
                          onValueChange={(value) => 
                            setPartParams(prev => ({
                              ...prev,
                              lowerBody: { ...prev.lowerBody, dof: value }
                            }))
                          }
                          className="flex gap-2"
                        >
                          <div className="flex items-center space-x-1.5 flex-1">
                            <RadioGroupItem value="5" id="lower-5" />
                            <Label htmlFor="lower-5" className="cursor-pointer text-xs">5自由度</Label>
                          </div>
                          <div className="flex items-center space-x-1.5 flex-1">
                            <RadioGroupItem value="6" id="lower-6" />
                            <Label htmlFor="lower-6" className="cursor-pointer text-xs">6自由度</Label>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-foreground">负载</Label>
                          <span className="text-xs font-semibold text-primary">{partParams.lowerBody.payload}kg</span>
                        </div>
                        <Slider
                          value={[partParams.lowerBody.payload]}
                          onValueChange={([value]) =>
                            setPartParams(prev => ({
                              ...prev,
                              lowerBody: { ...prev.lowerBody, payload: value }
                            }))
                          }
                          min={20}
                          max={35}
                          step={0.1}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>20kg</span>
                          <span>35kg</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-foreground">自重</Label>
                          <span className="text-xs font-semibold text-primary">{partParams.lowerBody.weight}kg</span>
                        </div>
                        <Slider
                          value={[partParams.lowerBody.weight]}
                          onValueChange={([value]) =>
                            setPartParams(prev => ({
                              ...prev,
                              lowerBody: { ...prev.lowerBody, weight: value }
                            }))
                          }
                          min={25}
                          max={50}
                          step={0.1}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>25kg</span>
                          <span>50kg</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-foreground">速度</Label>
                          <span className="text-xs font-semibold text-primary">{partParams.lowerBody.speed}m/s</span>
                        </div>
                        <Slider
                          value={[partParams.lowerBody.speed]}
                          onValueChange={([value]) =>
                            setPartParams(prev => ({
                              ...prev,
                              lowerBody: { ...prev.lowerBody, speed: value }
                            }))
                          }
                          min={1}
                          max={5}
                          step={0.1}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>1m/s</span>
                          <span>5m/s</span>
                        </div>
                      </div>
                      
                      <Button
                        onClick={handleGenerateLowerBody}
                        disabled={isLoadingLowerBody}
                        className="w-full mt-1 h-8 text-sm font-medium shadow-sm"
                      >
                        {isLoadingLowerBody ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            生成中...
                          </>
                        ) : (
                          "生成下半身"
                        )}
                      </Button>
                    </div>
                  </div>
                </ScrollArea>
                </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsParamsPanelCollapsed(false)}
                      className="h-8 w-8"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                    <div 
                      className="writing-mode-vertical text-xs text-muted-foreground cursor-pointer hover:text-primary transition-colors"
                      onClick={() => setIsParamsPanelCollapsed(false)}
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      参数设置
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* 右侧：部件展示区 */}
            <ResizablePanel 
              defaultSize={isParamsPanelCollapsed ? 97 : 80} 
              minSize={50} 
              maxSize={isParamsPanelCollapsed ? 97 : 80}
            >
              <div className="flex flex-col h-[calc(98vh-120px)] pl-4">
                <h3 className="text-lg font-semibold mb-4">
                  部件展示区
                </h3>
                
                {/* 内容区域：24个部件时为横向布局 */}
                <div className={`flex-1 ${upperBodyStage === 'stage2' && !hideUpperBodyStage2 && lowerBodyStage === 'stage2' && !hideLowerBodyStage2 ? 'flex flex-row gap-6' : 'flex flex-col'}`}>
                  {/* 左侧：部件展示区域 */}
                  <div className={`flex flex-col gap-1 ${upperBodyStage === 'stage2' && !hideUpperBodyStage2 && lowerBodyStage === 'stage2' && !hideLowerBodyStage2 ? 'flex-1' : 'w-full flex-1'}`}>
                  {/* 上半身展示区 */} 
                  {((upperBodyStage === 'stage2' && !hideUpperBodyStage2) || (upperBodyStage === 'stage1' && upperBodyParts.length > 0 && !hideUpperBodyStage1)) && (
                    <div className={'flex-1 flex flex-col min-h-0 animate-fade-in'}>
                      <h4 className="font-medium mb-1 text-sm">
                        上半身
                      </h4>
                    {upperBodyStage === 'stage2' && !hideUpperBodyStage2 ? (
                      <div className="border rounded-lg p-1 flex-1 min-h-0 flex flex-col">
                        {upperBodyParts.length > 0 ? (
                          <div className={`grid grid-cols-6 grid-rows-2 gap-1 flex-1 ${lowerBodyStage === 'stage2' && !hideLowerBodyStage2 ? 'max-h-[32vh]' : ''}`}>
                            {upperBodyParts.filter((part): part is RobotPart => part !== null).map((part) => (
                              <div
                                key={part.id}
                                className={`border rounded p-1 cursor-pointer transition-all flex flex-col justify-center h-full ${
                                  (lowerBodyStage === 'stage2' && !hideLowerBodyStage2 && selectedUpperBodyForAssemble?.id === part.id) ||
                                  (!(lowerBodyStage === 'stage2' && !hideLowerBodyStage2) && selectedUpperPart === part.id)
                                    ? "ring-2 ring-primary"
                                    : "hover:border-primary"
                                }`}
                                onClick={() => {
                                  if (lowerBodyStage === 'stage2' && !hideLowerBodyStage2) {
                                    // 24个部件模式：用于拼接
                                    setSelectedUpperBodyForAssemble(part);
                                  } else {
                                    // 12个部件模式：用于组合
                                    setSelectedUpperPart(part.id);
                                  }
                                }}
                              >
                                <div className="w-full max-h-80 rounded overflow-hidden bg-muted mb-0.5 relative flex items-center justify-center">
                                  {part.imageUrl ? (
                                    <img
                                      src={part.imageUrl}
                                      alt={part.name}
                                      className="w-full h-full object-contain"
                                    />
                                  ) : (
                                    <div className="flex items-center justify-center h-full">
                                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                    </div>
                                  )}
                                   {/* View button */}
                                   <Button
                                     size="icon"
                                     variant="secondary"
                                     className="absolute bottom-2 left-2 h-7 w-7"
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       setViewerRobotId(part.id);
                                       setViewerOpen(true);
                                     }}
                                   >
                                     <Eye className="h-4 w-4" />
                                   </Button>
                                   {part.length !== undefined && (
                                    <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-[9px] text-foreground space-y-0.5">
                                      <div>工作半径: {part.length.toFixed(2)}m</div>
                                      <div>质量: {part.mass?.toFixed(2)}kg</div>
                                      <div>负载: {part.load?.toFixed(2)}kg</div>
                                      <div>自由度: {part.dofs}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                            点击生成按钮生成上半身部件
                          </div>
                        )}
                      </div>
                    ) :
                    !hideUpperBodyStage1 ? (
                      <div className="border rounded-lg flex-1 min-h-0 flex flex-col">
                        {upperBodyParts.length > 0 || isLoadingUpperBody ? (
                          <>
                            {/* 图片展示区 - 占60%高度 */}
                            <div className="flex flex-col p-2 border-b" style={{ height: '60%' }}>
                              <div className="grid grid-cols-4 gap-2 flex-1">
                              {/* 前3个位置显示机器人图片 */}
                              {upperBodyParts.filter((part): part is RobotPart => part !== null).slice(0, 3).map((part, index) => (
                                <div
                                  key={`${part.id}-${index}`}
                                  className={`border rounded-lg p-2 cursor-pointer transition-all animate-slide-in-right h-full flex flex-col justify-center ${
                                    selectedUpperPart === part.id
                                      ? "ring-2 ring-primary"
                                      : "hover:border-primary"
                                  }`}
                                  style={{
                                    animationDelay: `${index * 0.1}s`
                                  }}
                                  onClick={() => setSelectedUpperPart(part.id)}
                                >
                                  <div className="aspect-square rounded-md overflow-hidden bg-muted mb-1 relative flex items-center justify-center">
                                    {part.imageUrl ? (
                                      <img
                                        src={part.imageUrl}
                                        alt={part.name}
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <div className="flex items-center justify-center h-full">
                                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                      </div>
                                    )}
                                    {part.length !== undefined && (
                                      <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-[10px] text-foreground space-y-0.5">
                                        <div>工作半径: {part.length.toFixed(2)}m</div>
                                        <div>质量: {part.mass?.toFixed(2)}kg</div>
                                        <div>负载: {part.load?.toFixed(2)}kg</div>
                                        <div>自由度: {part.dofs}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {/* 第4个位置：等待动画卡片 */}
                              {isLoadingUpperBody && (
                                <div className="border rounded-lg p-2 flex items-center justify-center bg-muted/30 animate-pulse h-full">
                                  <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="text-xs text-muted-foreground">生成中...</p>
                                  </div>
                                </div>
                              )}
                              </div>
                            </div>
                            
                            {/* 参数图表区 - 占40%高度 */}
                            {upperBodyParamHistory.length > 0 && (
                              <div className="flex flex-col p-2" style={{ height: '40%' }}>
                                <div className="grid grid-cols-4 gap-2 flex-1">
                                {/* 雷达图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">参数对比雷达图</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        radar: {
                                          indicator: [
                                            { name: '负载', max: Math.max(partParams.upperBody.payload, upperBodyParamHistory[upperBodyParamHistory.length - 1].payload ) },
                                            { name: '自重', max: Math.max(partParams.upperBody.weight, upperBodyParamHistory[upperBodyParamHistory.length - 1].weight ) },
                                            { name: '工作半径', max: Math.max(partParams.upperBody.workRadius, (upperBodyParamHistory[upperBodyParamHistory.length - 1].workRadius || 0))},
                                          ],
                                          shape: 'circle',
                                          splitLine: {
                                            lineStyle: {
                                              color: [
                                                'rgba(238, 197, 102, 0.1)'
                                              ]
                                            }
                                          },
                                          splitArea: {
                                            show: false
                                          },
                                        },
                                        legend: {
                                          data: ['输入值', '生成值'],
                                          textStyle: { fontSize: 10 }
                                        },
                                        series: [
                                          {
                                            name: '输入值',
                                            type: 'radar',
                                            data: [
                                              {
                                                value: [partParams.upperBody.payload, partParams.upperBody.weight, partParams.upperBody.workRadius],
                                                name: '输入值',
                                                areaStyle: { opacity: 0.2 }
                                              }
                                            ]
                                          },
                                          {
                                            name: '生成值',
                                            type: 'radar',
                                            data: [
                                              {
                                                value: [
                                                  upperBodyParamHistory[upperBodyParamHistory.length - 1].payload,
                                                  upperBodyParamHistory[upperBodyParamHistory.length - 1].weight,
                                                  upperBodyParamHistory[upperBodyParamHistory.length - 1].workRadius || 0
                                                ],
                                                name: '生成值',
                                                areaStyle: { opacity: 0.2 }
                                              }
                                            ]
                                          }
                                        ]
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>

                                {/* 负载曲线图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">负载变化</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        grid: { left: 40, right: 20, top: 20, bottom: 30 },
                                        xAxis: {
                                          type: 'category',
                                          data: upperBodyParamHistory.map((_, i) => i + 1),
                                          axisLabel: { fontSize: 9 }
                                        },
                                        yAxis: {
                                          type: 'value',
                                          axisLabel: { fontSize: 9 },
                                          splitLine: { show: false }
                                        },
                                        series: [
                                          {
                                            name: '生成值',
                                            type: 'line',
                                            data: upperBodyParamHistory.map(d => d.payload),
                                            smooth: true,
                                            lineStyle: { 
                                              width: 3,
                                              color: {
                                                type: 'linear',
                                                x: 0, y: 0, x2: 1, y2: 0,
                                                colorStops: [
                                                  { offset: 0, color: '#3b82f6' },
                                                  { offset: 1, color: '#8b5cf6' }
                                                ]
                                              }
                                            },
                                            // symbol: (value: any, params: any) => {
                                            //   return params.dataIndex === upperBodyParamHistory.length - 1 ? 'circle' : 'none';
                                            // },
                                            // symbolSize: 8,
                                            // itemStyle: {
                                            //   color: '#3b82f6'
                                            // }
                                            symbol: 'none'
                                          },
                                          {
                                            name: '输入值',
                                            type: 'line',
                                            data: upperBodyParamHistory.map(() => partParams.upperBody.payload),
                                            lineStyle: { type: 'dashed', width: 1 },
                                            symbol: 'none'
                                          }
                                        ],
                                        tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } }
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>

                                {/* 自重曲线图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">自重变化</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        grid: { left: 40, right: 20, top: 20, bottom: 30 },
                                        xAxis: {
                                          type: 'category',
                                          data: upperBodyParamHistory.map((_, i) => i + 1),
                                          axisLabel: { fontSize: 9 }
                                        },
                                        yAxis: {
                                          type: 'value',
                                          axisLabel: { fontSize: 9 },
                                          splitLine: { show: false }
                                        },
                                        series: [
                                          {
                                            name: '生成值',
                                            type: 'line',
                                            data: upperBodyParamHistory.map(d => d.weight),
                                            smooth: true,
                                            lineStyle: { 
                                              width: 3,
                                              color: {
                                                type: 'linear',
                                                x: 0, y: 0, x2: 1, y2: 0,
                                                colorStops: [
                                                  { offset: 0, color: '#10b981' },
                                                  { offset: 1, color: '#14b8a6' }
                                                ]
                                              }
                                            },
                                            // symbol: (value: any, params: any) => {
                                            //   return params.dataIndex === upperBodyParamHistory.length - 1 ? 'circle' : 'none';
                                            // },
                                            // symbolSize: 8,
                                            // itemStyle: {
                                            //   color: '#10b981'
                                            // }
                                            symbol: 'none'
                                          },
                                          {
                                            name: '输入值',
                                            type: 'line',
                                            data: upperBodyParamHistory.map(() => partParams.upperBody.weight),
                                            lineStyle: { type: 'dashed', width: 1 },
                                            symbol: 'none'
                                          }
                                        ],
                                        tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } }
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>

                                {/* 工作半径曲线图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">工作半径变化</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        grid: { left: 40, right: 20, top: 20, bottom: 30 },
                                        xAxis: {
                                          type: 'category',
                                          data: upperBodyParamHistory.map((_, i) => i + 1),
                                          axisLabel: { fontSize: 9 }
                                        },
                                        yAxis: {
                                          type: 'value',
                                          axisLabel: { fontSize: 9 },
                                          splitLine: { show: false }
                                        },
                                        series: [
                                          {
                                            name: '生成值',
                                            type: 'line',
                                            data: upperBodyParamHistory.map(d => d.workRadius || 0),
                                            smooth: true,
                                            lineStyle: { 
                                              width: 3,
                                              color: {
                                                type: 'linear',
                                                x: 0, y: 0, x2: 1, y2: 0,
                                                colorStops: [
                                                  { offset: 0, color: '#f59e0b' },
                                                  { offset: 1, color: '#ef4444' }
                                                ]
                                              }
                                            },
                                            // symbol: (value: any, params: any) => {
                                            //   return params.dataIndex === upperBodyParamHistory.length - 1 ? 'circle' : 'none';
                                            // },
                                            // symbolSize: 8,
                                            // itemStyle: {
                                            //   color: '#ef4444'
                                            // }
                                            symbol: 'none'
                                          },
                                          {
                                            name: '输入值',
                                            type: 'line',
                                            data: upperBodyParamHistory.map(() => partParams.upperBody.workRadius),
                                            lineStyle: { type: 'dashed', width: 1 },
                                            symbol: 'none'
                                          }
                                        ],
                                        tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } }
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                            点击生成按钮生成上半身部件
                          </div>
                        )}
                      </div>
                    ) : null}
                    </div>
                  )}
                  
                  {/* 下半身展示区 */}
                  {((lowerBodyStage === 'stage2'  && !hideLowerBodyStage2) || (lowerBodyStage === 'stage1' && lowerBodyParts.length > 0  && !hideLowerBodyStage1)) && (
                    <div className={'flex-1 flex flex-col min-h-0 animate-fade-in'}>
                      <h4 className="font-medium mb-1 text-sm">
                        下半身
                      </h4>
                    {lowerBodyStage === 'stage2' && !hideLowerBodyStage2 ? (
                      <div className="border rounded-lg p-1 flex-1 min-h-0 flex flex-col">
                        {lowerBodyParts.length > 0 ? (
                          <div className={`grid grid-cols-6 grid-rows-2 gap-1 flex-1 ${upperBodyStage === 'stage2' && !hideUpperBodyStage2 ? 'max-h-[32vh]' : ''}`}>
                            {lowerBodyParts.filter((part): part is RobotPart => part !== null).map((part) => (
                              <div
                                key={part.id}
                                className={`border rounded p-1 cursor-pointer transition-all flex flex-col justify-center h-full ${
                                  (upperBodyStage === 'stage2' && !hideUpperBodyStage2 && selectedLowerBodyForAssemble?.id === part.id) ||
                                  (!(upperBodyStage === 'stage2' && !hideUpperBodyStage2) && selectedLowerPart === part.id)
                                    ? "ring-2 ring-primary"
                                    : "hover:border-primary"
                                }`}
                                onClick={() => {
                                  if (upperBodyStage === 'stage2' && !hideUpperBodyStage2) {
                                    // 24个部件模式：用于拼接
                                    setSelectedLowerBodyForAssemble(part);
                                  } else {
                                    // 12个部件模式：用于组合
                                    setSelectedLowerPart(part.id);
                                  }
                                }}
                              >
                                <div className="w-full max-h-80 rounded overflow-hidden bg-muted mb-0.5 relative flex items-center justify-center">
                                  {part.imageUrl ? (
                                    <img
                                      src={part.imageUrl}
                                      alt={part.name}
                                      className="w-full h-full object-contain"
                                    />
                                  ) : (
                                    <div className="flex items-center justify-center h-full">
                                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                    </div>
                                  )}
                                   {/* View button */}
                                   <Button
                                     size="icon"
                                     variant="secondary"
                                     className="absolute bottom-2 left-2 h-7 w-7"
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       setViewerRobotId(part.id);
                                       setViewerOpen(true);
                                     }}
                                   >
                                     <Eye className="h-4 w-4" />
                                   </Button>
                                   {part.velocity !== undefined && (
                                    <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-[9px] text-foreground space-y-0.5">
                                      <div>速度: {part.velocity.toFixed(2)}m/s</div>
                                      <div>质量: {part.mass?.toFixed(2)}kg</div>
                                      <div>负载: {part.load?.toFixed(2)}kg</div>
                                      <div>自由度: {part.dofs}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                            点击生成按钮生成下半身部件
                          </div>
                        )}
                      </div>
                    ) : !hideLowerBodyStage1 ? (
                      <div className="border rounded-lg flex-1 min-h-0 flex flex-col">
                        {lowerBodyParts.length > 0 || isLoadingLowerBody ? (
                          <>
                            {/* 图片展示区 - 占60%高度 */}
                            <div className="flex flex-col p-2 border-b" style={{ height: '60%' }}>
                              <div className="grid grid-cols-4 gap-2 flex-1">
                              {/* 前3个位置显示机器人图片 */}
                              {lowerBodyParts.filter((part): part is RobotPart => part !== null).slice(0, 3).map((part, index) => (
                                <div
                                  key={`${part.id}-${index}`}
                                  className={`border rounded-lg p-2 cursor-pointer transition-all animate-slide-in-right h-full flex flex-col justify-center ${
                                    selectedLowerPart === part.id
                                      ? "ring-2 ring-primary"
                                      : "hover:border-primary"
                                  }`}
                                  style={{
                                    animationDelay: `${index * 0.1}s`
                                  }}
                                  onClick={() => setSelectedLowerPart(part.id)}
                                >
                                  <div className="aspect-square rounded-md overflow-hidden bg-muted mb-1 relative flex items-center justify-center">
                                    {part.imageUrl ? (
                                      <img
                                        src={part.imageUrl}
                                        alt={part.name}
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <div className="flex items-center justify-center h-full">
                                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                      </div>
                                    )}
                                    {part.velocity !== undefined && (
                                      <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-[10px] text-foreground space-y-0.5">
                                        <div>速度: {part.velocity.toFixed(2)}m/s</div>
                                        <div>质量: {part.mass?.toFixed(2)}kg</div>
                                        <div>负载: {part.load?.toFixed(2)}kg</div>
                                        <div>自由度: {part.dofs}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {/* 第4个位置：等待动画卡片 */}
                              {isLoadingLowerBody && (
                                <div className="border rounded-lg p-2 flex items-center justify-center bg-muted/30 animate-pulse h-full">
                                  <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="text-xs text-muted-foreground">生成中...</p>
                                  </div>
                                </div>
                              )}
                              </div>
                            </div>

                            {/* 参数图表区 - 占40%高度 */}
                            {lowerBodyParamHistory.length > 0 && (
                              <div className="flex flex-col p-2" style={{ height: '40%' }}>
                                <div className="grid grid-cols-4 gap-2 flex-1">
                                {/* 雷达图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">参数对比雷达图</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        radar: {
                                          indicator: [
                                            { name: '负载', max: Math.max(partParams.lowerBody.payload, lowerBodyParamHistory[lowerBodyParamHistory.length - 1].payload ) },
                                            { name: '自重', max: Math.max(partParams.lowerBody.weight, lowerBodyParamHistory[lowerBodyParamHistory.length - 1].weight) },
                                            { name: '速度', max: Math.max(partParams.lowerBody.speed, (lowerBodyParamHistory[lowerBodyParamHistory.length - 1].speed || 0) ) },
                                          ],
                                          shape: 'circle',
                                          splitLine: {
                                            lineStyle: {
                                              color: [
                                                'rgba(238, 197, 102, 0.1)'
                                              ]
                                            }
                                          },
                                          splitArea: {
                                            show: false
                                          },
                                        },
                                        
                                        legend: {
                                          data: ['输入值', '生成值'],
                                          textStyle: { fontSize: 10 }
                                        },
                                        series: [
                                          {
                                            name: '输入值',
                                            type: 'radar',
                                            data: [
                                              {
                                                value: [partParams.lowerBody.payload, partParams.lowerBody.weight, partParams.lowerBody.speed],
                                                name: '输入值',
                                                areaStyle: { opacity: 0.2 }
                                              }
                                            ]
                                          },
                                          {
                                            name: '生成值',
                                            type: 'radar',
                                            data: [
                                              {
                                                value: [
                                                  lowerBodyParamHistory[lowerBodyParamHistory.length - 1].payload,
                                                  lowerBodyParamHistory[lowerBodyParamHistory.length - 1].weight,
                                                  lowerBodyParamHistory[lowerBodyParamHistory.length - 1].speed || 0
                                                ],
                                                name: '生成值',
                                                areaStyle: { opacity: 0.2 }
                                              }
                                            ]
                                          }
                                        ]
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>

                                {/* 负载曲线图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">负载变化</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        grid: { left: 40, right: 20, top: 20, bottom: 30 },
                                        xAxis: {
                                          type: 'category',
                                          data: lowerBodyParamHistory.map((_, i) => i + 1),
                                          axisLabel: { fontSize: 9 }
                                        },
                                        yAxis: {
                                          type: 'value',
                                          axisLabel: { fontSize: 9 },
                                          splitLine: { show: false }
                                        },
                                        series: [
                                          {
                                            name: '生成值',
                                            type: 'line',
                                            data: lowerBodyParamHistory.map(d => d.payload),
                                            smooth: true,
                                            lineStyle: { 
                                              width: 3,
                                              color: {
                                                type: 'linear',
                                                x: 0, y: 0, x2: 1, y2: 0,
                                                colorStops: [
                                                  { offset: 0, color: '#3b82f6' },
                                                  { offset: 1, color: '#8b5cf6' }
                                                ]
                                              }
                                            },
                                            // symbol: (value: any, params: any) => {
                                            //   return params.dataIndex === lowerBodyParamHistory.length - 1 ? 'circle' : 'none';
                                            // },
                                            // symbolSize: 8,
                                            // itemStyle: {
                                            //   color: '#3b82f6'
                                            // }
                                            symbol: 'none'
                                          },
                                          {
                                            name: '输入值',
                                            type: 'line',
                                            data: lowerBodyParamHistory.map(() => partParams.lowerBody.payload),
                                            lineStyle: { type: 'dashed', width: 1 },
                                            symbol: 'none'
                                          }
                                        ],
                                        tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } }
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>

                                {/* 自重曲线图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">自重变化</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        grid: { left: 40, right: 20, top: 20, bottom: 30 },
                                        xAxis: {
                                          type: 'category',
                                          data: lowerBodyParamHistory.map((_, i) => i + 1),
                                          axisLabel: { fontSize: 9 }
                                        },
                                        yAxis: {
                                          type: 'value',
                                          axisLabel: { fontSize: 9 },
                                          splitLine: { show: false }
                                        },
                                        series: [
                                          {
                                            name: '生成值',
                                            type: 'line',
                                            data: lowerBodyParamHistory.map(d => d.weight),
                                            smooth: true,
                                            lineStyle: { 
                                              width: 3,
                                              color: {
                                                type: 'linear',
                                                x: 0, y: 0, x2: 1, y2: 0,
                                                colorStops: [
                                                  { offset: 0, color: '#10b981' },
                                                  { offset: 1, color: '#14b8a6' }
                                                ]
                                              }
                                            },
                                            // symbol: (value: any, params: any) => {
                                            //   return params.dataIndex === lowerBodyParamHistory.length - 1 ? 'circle' : 'none';
                                            // },
                                            // symbolSize: 8,
                                            // itemStyle: {
                                            //   color: '#10b981'
                                            // }
                                            symbol: 'none'
                                          },
                                          {
                                            name: '输入值',
                                            type: 'line',
                                            data: lowerBodyParamHistory.map(() => partParams.lowerBody.weight),
                                            lineStyle: { type: 'dashed', width: 1 },
                                            symbol: 'none'
                                          }
                                        ],
                                        tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } }
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>

                                {/* 速度曲线图 */}
                                <div className="border rounded-lg p-2 bg-card h-full flex flex-col">
                                  <h5 className="text-xs font-medium mb-1 text-center">速度变化</h5>
                                  <div className="flex-1">
                                    <ReactECharts
                                      option={{
                                        grid: { left: 40, right: 20, top: 20, bottom: 30 },
                                        xAxis: {
                                          type: 'category',
                                          data: lowerBodyParamHistory.map((_, i) => i + 1),
                                          axisLabel: { fontSize: 9 }
                                        },
                                        yAxis: {
                                          type: 'value',
                                          axisLabel: { fontSize: 9 },
                                          splitLine: { show: false }
                                        },
                                        series: [
                                          {
                                            name: '生成值',
                                            type: 'line',
                                            data: lowerBodyParamHistory.map(d => d.speed || 0),
                                            smooth: true,
                                            lineStyle: { 
                                              width: 3,
                                              color: {
                                                type: 'linear',
                                                x: 0, y: 0, x2: 1, y2: 0,
                                                colorStops: [
                                                  { offset: 0, color: '#f59e0b' },
                                                  { offset: 1, color: '#ef4444' }
                                                ]
                                              }
                                            },
                                            // symbol: (value: any, params: any) => {
                                            //   return params.dataIndex === lowerBodyParamHistory.length - 1 ? 'circle' : 'none';
                                            // },
                                            // symbolSize: 8,
                                            // itemStyle: {
                                            //   color: '#ef4444'
                                            // }
                                            symbol: 'none'
                                          },
                                          {
                                            name: '输入值',
                                            type: 'line',
                                            data: lowerBodyParamHistory.map(() => partParams.lowerBody.speed),
                                            lineStyle: { type: 'dashed', width: 1 },
                                            symbol: 'none'
                                          }
                                        ],
                                        tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } }
                                      }}
                                      style={{ height: '100%', width: '100%' }}
                                    />
                                  </div>
                                </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                            点击生成按钮生成下半身部件
                          </div>
                        )}
                      </div>
                      ) : null}
                    </div>
                  )}

                    {/* 组合按钮 (仅在没有24个部件时显示) */}
                    {upperBodyStage === 'stage2' && lowerBodyStage === 'stage2' && upperBodyParts.length > 0 && lowerBodyParts.length > 0 && 
                     !(upperBodyStage === 'stage2' && !hideUpperBodyStage2 && lowerBodyStage === 'stage2' && !hideLowerBodyStage2) && (
                      <Button
                        onClick={handleCombineParts}
                        disabled={!selectedUpperPart || !selectedLowerPart}
                        className="w-full mt-2"
                      >
                        组合部件
                      </Button>
                    )}
                  </div>

                  {/* 右侧：拼接区域（仅在24个部件时显示） */}
                  {upperBodyStage === 'stage2' && !hideUpperBodyStage2 && lowerBodyStage === 'stage2' && !hideLowerBodyStage2 && (
                    <div className="w-80 flex flex-col gap-4 shrink-0">
                      {/* 拼接预览卡片 */}
                      <div className="h-[calc(100vh-280px)] border rounded-lg overflow-hidden relative bg-card">
                        {assembledRobot?.imageUrl ? (
                          <>
                            <img
                              src={assembledRobot.imageUrl}
                              alt="拼接后的机器人"
                              className="w-full h-full object-contain"
                            />
                            {/* View button */}
                            <Button
                              size="icon"
                              variant="secondary"
                              className="absolute bottom-2 left-2 h-8 w-8"
                              onClick={() => {
                                setViewerRobotId(assembledRobot.id);
                                setViewerOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {/* 参数浮层 */}
                            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs p-2 rounded space-y-1">
                              <div>工作半径: {assembledRobot.length?.toFixed(2)}m</div>
                              <div>速度: {assembledRobot.velocity?.toFixed(2)}m/s</div>
                              <div>自重: {assembledRobot.mass?.toFixed(2)}kg</div>
                              <div>负载: {assembledRobot.load?.toFixed(2)}kg</div>
                              <div>自由度: {assembledRobot.dofs}</div>
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted/50 border-2 border-dashed border-muted-foreground/20">
                            <div className="text-center text-muted-foreground space-y-2">
                              <Package className="h-12 w-12 mx-auto opacity-50" />
                              <p className="text-sm">拼接预览</p>
                              <p className="text-xs text-muted-foreground/70">选择部件后点击拼接</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 拼接按钮 */}
                      <Button
                        onClick={handleAssembleRobot}
                        disabled={!selectedUpperBodyForAssemble || !selectedLowerBodyForAssemble || isAssembling}
                        className="w-full"
                        size="lg"
                      >
                        {isAssembling ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            拼接中...
                          </>
                        ) : (
                          <>
                            <Package className="mr-2 h-4 w-4" />
                            拼接机器人
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {/* 组合预览对话框 */}
        <CombinedRobotPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          combinedRobot={combinedRobot}
          robotParams={partParams}
          onSave={handleSaveCombinedRobot}
        />
      </DialogContent>

      {/* Robot Viewer Dialog */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] h-[90vh] p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>机器人3D查看器</DialogTitle>
          </DialogHeader>
          <div className="flex-1 h-[85vh] ">
            <iframe
              title="robotviewer"
              src={viewerRobotId ? `${API_CONFIG.robotViewerUrl}?robot_id=${encodeURIComponent(viewerRobotId)}` : API_CONFIG.robotViewerUrl}
              className="w-full h-full border-none"
              style={{ display: "block" }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
