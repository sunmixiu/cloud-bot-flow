// API全局配置
import mqtt from 'mqtt';

//测试环境配置
// export const API_CONFIG = {
//   baseUrl: 'http://192.168.80.229',
//   deployBaseUrl: 'http://172.18.12.31:30080',
//   monitoringUrl: 'http://192.168.80.210:8081/frontend/',
//   trainingUrl: 'https://one-key-start.jszn.ai/',
//   authToken: 'xxx',
//   mqttUrl: 'ws://172.18.12.31:30901',
//   robotImageUrl: 'http://172.18.12.31:30003',
//   robotViewerUrl: 'https://robot-viewer.jszn.ai/',
//   brainAssemblyUrl: 'https://brain.jszn.ai/',
// };

// 生产环境配置-10楼
// export const API_CONFIG = {
//   baseUrl: 'http://172.18.12.31:31180',
//   deployBaseUrl: 'http://172.18.12.31:30080',
//   monitoringUrl: 'http://192.168.80.210:8081/frontend/',
//   trainingUrl: 'https://one-key-start.jszn.ai/',
//   authToken: 'xxx',
//   mqttUrl: 'ws://172.18.12.31:30901',
//   robotImageUrl: 'http://172.18.12.31:30003',
//   robotViewerUrl: 'https://robot-viewer.jszn.ai/',
//   brainAssemblyUrl: 'https://brain.jszn.ai/',
// };

//生产环境配置-2楼
const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
const localApiBaseUrl = import.meta.env.DEV ? '/api/cube' : '';

export const API_CONFIG = {
  localMode: !import.meta.env.VITE_API_BASE_URL,
  baseUrl: import.meta.env.VITE_API_BASE_URL || localApiBaseUrl,
  deployBaseUrl: import.meta.env.VITE_DEPLOY_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || localApiBaseUrl,
  monitoringUrl: import.meta.env.VITE_MONITORING_URL || '/monitoring.html',
  trainingUrl: import.meta.env.VITE_TRAINING_URL || '/training.html',
  authToken: 'xxx',
  mqttUrl: import.meta.env.VITE_MQTT_URL || (isHttps ? 'wss://mqtt-service.mqtt-system:9001' : 'ws://mqtt-service.mqtt-system:9001'),
  // mqttUrl: isHttps ? 'wss://172.18.12.31:30901' : 'ws://172.18.12.31:30901',
  robotImageUrl: import.meta.env.VITE_ROBOT_IMAGE_URL || import.meta.env.VITE_API_BASE_URL || localApiBaseUrl,
  robotViewerUrl: import.meta.env.VITE_ROBOT_VIEWER_URL || '/viewer.html',
  brainAssemblyUrl: import.meta.env.VITE_BRAIN_ASSEMBLY_URL || '/viewer.html?mode=assembly',
};


// 获取认证头
export const getAuthHeaders = () => {
  let token = '';
  if (typeof window !== 'undefined') {
    try {
      token = JSON.parse(localStorage.getItem('user') || '{}')?.token || '';
    } catch {
      token = '';
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
};

// API端点配置
export const API_ENDPOINTS = {
  images: '/images_modelview/api/',
  projects: '/project_modelview/api/',
  datasets: '/dataset_modelview/api/',
  pipelines: '/pipeline_modelview/api/',
  robots: '/robot_modelview/api/',
  codeModules: '/code_repository/api/',
  simulationAlgorithms: '/simulation_algorithm/api/',
  platformCapabilities: '/platform/capabilities',
  imageBuilds: '/platform/image-builds',
  registryRepositories: '/platform/registry/repositories',
  registryImages: '/platform/registry/images',
  pipelineRuns: '/platform/pipeline-runs',
  artifacts: '/platform/artifacts',
  deploy: '/deploy',
  robotImage: '/get_image',
};

// 构建完整的API URL
export const buildApiUrl = (endpoint: string, useDeployBase = false) => {
  const baseUrl = useDeployBase ? API_CONFIG.deployBaseUrl : API_CONFIG.baseUrl;
  return `${baseUrl}${endpoint}`;
};

// 通用API请求函数
export const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const url = buildApiUrl(endpoint);
  const config: RequestInit = {
    method: 'GET',
    headers: getAuthHeaders(),
    ...options,
  };

  const response = await fetch(url, config);
  
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(
      payload.message || `API请求失败: ${response.status} ${response.statusText}`
    ) as Error & { status?: number; result?: unknown };
    error.status = response.status;
    error.result = payload.result;
    throw error;
  }
  
  return response.json();
};

// 算法相关API
export const algorithmApi = {
  // 获取算法列表
  getList: () => apiRequest<any[]>(API_ENDPOINTS.images),
  
  // 获取单个算法
  getById: (id: string) => apiRequest<any>(`${API_ENDPOINTS.images}${id}`),
  
  // 创建算法
  create: (data: any) => apiRequest<any>(API_ENDPOINTS.images, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 更新算法
  update: (id: string, data: any) => apiRequest<any>(`${API_ENDPOINTS.images}${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  // 删除算法
  delete: (id: string) => apiRequest<any>(`${API_ENDPOINTS.images}${id}`, {
    method: 'DELETE',
  }),
};

// 项目相关API
export const projectApi = {
  // 获取项目列表
  getList: () => apiRequest<any[]>(API_ENDPOINTS.projects),
  
  // 获取单个项目
  getById: (id: number) => apiRequest<any>(`${API_ENDPOINTS.projects}${id}`),
  
  // 创建项目
  create: (data: any) => apiRequest<any>(API_ENDPOINTS.projects, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 更新项目
  update: (id: number, data: any) => apiRequest<any>(`${API_ENDPOINTS.projects}${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  // 删除项目
  delete: (id: number) => apiRequest<any>(`${API_ENDPOINTS.projects}${id}`, {
    method: 'DELETE',
  }),
};

// 数据集相关API
export const datasetApi = {
  // 获取数据集列表
  getList: () => apiRequest<any[]>(API_ENDPOINTS.datasets),
  
  // 获取单个数据集
  getById: (id: number) => apiRequest<any>(`${API_ENDPOINTS.datasets}${id}`),
  
  // 创建数据集
  create: (data: any) => apiRequest<any>(API_ENDPOINTS.datasets, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 更新数据集
  update: (id: number, data: any) => apiRequest<any>(`${API_ENDPOINTS.datasets}${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  // 删除数据集
  delete: (id: number) => apiRequest<any>(`${API_ENDPOINTS.datasets}${id}`, {
    method: 'DELETE',
  }),
};

// 任务流相关API
export const pipelineApi = {
  // 获取任务流列表
  getList: () => apiRequest<any[]>(API_ENDPOINTS.pipelines),
  
  // 获取单个任务流
  getById: (id: number) => apiRequest<any>(`${API_ENDPOINTS.pipelines}${id}`),
  
  // 创建任务流
  create: (data: any) => apiRequest<any>(API_ENDPOINTS.pipelines, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 更新任务流
  update: (id: number, data: any) => apiRequest<any>(`${API_ENDPOINTS.pipelines}${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  // 删除任务流
  delete: (id: number) => apiRequest<any>(`${API_ENDPOINTS.pipelines}${id}`, {
    method: 'DELETE',
  }),
};

// 资源相关API（JSON文件）
export const resourceApi = {
  // 获取机器人数据
  getRobots: () => apiRequest<any>(API_ENDPOINTS.robots)
    .then(response => response?.result?.data || response),
  create: (data: any) => apiRequest<any>(API_ENDPOINTS.robots, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string | number, data: any) => apiRequest<any>(`${API_ENDPOINTS.robots}${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string | number) => apiRequest<any>(`${API_ENDPOINTS.robots}${id}`, {
    method: 'DELETE',
  }),
};

// 部署相关API
export const deployApi = {
  // 部署算法
  deploy: (data: {
    service: string;
    edge_node: string;
    robot_host: string;
    image: string;
    namespace: string;
  }) => {
    const url = buildApiUrl(API_ENDPOINTS.deploy, true);
    return fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    }).then(res => {
      if (!res.ok) {
        throw new Error(`部署失败: ${res.status} ${res.statusText}`);
      }
      return res.json();
    });
  },
};

// 机器人图片相关API
export const robotImageApi = {
  // 根据模型路径获取机器人图片
  getImage: (modelPath: string) => {
    const baseUrl = API_CONFIG.robotImageUrl;
    const url = `${baseUrl}${API_ENDPOINTS.robotImage}?model_path=${encodeURIComponent(modelPath)}`;
    return fetch(url).then(res => {
      if (!res.ok) {
        throw new Error(`获取图片失败: ${res.status} ${res.statusText}`);
      }
      return res.blob();
    }).then(blob => URL.createObjectURL(blob));
  },
};

export const robotImageUrl = {
  // 根据模型路径获取机器人图片
  getImage: (modelPath: string) => {
    const baseUrl = API_CONFIG.robotImageUrl;
    const url = `${baseUrl}${API_ENDPOINTS.robotImage}?model_path=${encodeURIComponent(modelPath)}`;
    return url;
  },
};

// MQTT客户端实例
let mqttClient: mqtt.MqttClient | null = null;

// MQTT连接管理
export const mqttApi = {
  // 获取或创建MQTT客户端连接
  getClient: () => {
    if (!mqttClient || !mqttClient.connected) {
      console.log('正在连接MQTT服务器:', API_CONFIG.mqttUrl);
      mqttClient = mqtt.connect(API_CONFIG.mqttUrl, {
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        keepalive: 60,
        clientId: "web_" + Math.random().toString(16).substr(2, 8),
      });

      mqttClient.on('connect', () => {
        console.log('MQTT连接成功');
      });

      mqttClient.on('error', (error) => {
        console.error('MQTT连接错误:', error);
        console.error('请检查MQTT服务器地址和端口是否正确，以及服务器是否支持WebSocket连接');
      });

      mqttClient.on('close', () => {
        console.log('MQTT连接关闭');
      });

      mqttClient.on('offline', () => {
        console.log('MQTT客户端离线');
      });

      mqttClient.on('reconnect', () => {
        console.log('正在重新连接MQTT服务器...');
      });
    }
    return mqttClient;
  },

  // 断开MQTT连接
  disconnect: () => {
    if (mqttClient) {
      mqttClient.end();
      mqttClient = null;
    }
  },
};

// MQTT 主题配置
export const MQTT_TOPICS = {
  designUpperBody: '/client_message/design_upper_body',
  designLowerBody: '/client_message/design_lower_body',
  assembleRobot: '/client_message/assemble_robot',
  robotImage: '/server_message/robot',
  robotIds: '/server_message/robot_ids',
};

export const robotDesignApi = {
  generate: (data: {
    type: 'upper' | 'lower';
    params: Record<string, string | number>;
  }) => apiRequest<any>('/robot-design/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  assemble: (data: {
    up_id: string;
    down_id: string;
  }) => apiRequest<any>('/robot-design/assemble', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

const createCrudApi = (endpoint: string) => ({
  getList: () => apiRequest<any>(endpoint),
  getById: (id: string | number) => apiRequest<any>(`${endpoint}${id}`),
  create: (data: any) => apiRequest<any>(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string | number, data: any) => apiRequest<any>(`${endpoint}${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string | number) => apiRequest<any>(`${endpoint}${id}`, {
    method: 'DELETE',
  }),
});

export const codeRepositoryApi = createCrudApi(API_ENDPOINTS.codeModules);
export const simulationAlgorithmApi = createCrudApi(API_ENDPOINTS.simulationAlgorithms);

export const simulationApi = {
  getScenarios: () => apiRequest<any>('/simulation/scenarios'),
  preflight: (data: {
    algorithms: any[];
    scene?: string;
    robot?: any;
  }) => apiRequest<any>('/simulation/preflight', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  run: (data: {
    workflow_name: string;
    robot?: any;
    algorithms: any[];
    scene?: string;
    seed?: number;
    fault_mode?: 'none' | 'sensor-dropout' | 'algorithm-timeout';
  }) => apiRequest<any>('/simulation/run', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getRuns: (limit = 50) => apiRequest<any>(`/simulation/runs?limit=${limit}`),
  getRun: (id: string) => apiRequest<any>(`/simulation/runs/${id}`),
  controlRun: (
    id: string,
    action: 'pause' | 'resume' | 'cancel',
    expectedRevision: number,
  ) =>
    apiRequest<any>(`/simulation/runs/${id}/control`, {
    method: 'POST',
    body: JSON.stringify({ action, expected_revision: expectedRevision }),
  }),
};

export const platformApi = {
  getCapabilities: () => apiRequest<any>(API_ENDPOINTS.platformCapabilities),
  getImageBuilds: () => apiRequest<any>(API_ENDPOINTS.imageBuilds),
  createImageBuild: (data: {
    code_module_id: string | number;
    source_ref?: string;
    dockerfile?: string;
    base_image: string;
    target_image: string;
    resource_cpu?: string;
    resource_memory?: string;
  }) => apiRequest<any>(API_ENDPOINTS.imageBuilds, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getRepositories: () => apiRequest<any>(API_ENDPOINTS.registryRepositories),
  createRepository: (data: {
    name: string;
    server: string;
    user?: string;
    password?: string;
    hubsecret: string;
  }) => apiRequest<any>(API_ENDPOINTS.registryRepositories, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getRegistryImages: () => apiRequest<any>(API_ENDPOINTS.registryImages),
  getPipelineRuns: () => apiRequest<any>(API_ENDPOINTS.pipelineRuns),
  createPipelineRun: (data: {
    pipeline_id: string | number;
    image_ids: Array<string | number>;
    parameters?: Record<string, unknown>;
  }) => apiRequest<any>(API_ENDPOINTS.pipelineRuns, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getArtifacts: () => apiRequest<any>(API_ENDPOINTS.artifacts),
  downloadArtifact: async (id: string | number, filename: string) => {
    const response = await fetch(
      buildApiUrl(`${API_ENDPOINTS.artifacts}/${encodeURIComponent(id)}/content`),
      { headers: getAuthHeaders() },
    );
    if (!response.ok) {
      throw new Error(`产物下载失败: ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
