# API配置说明

## 全局配置结构

### 1. 配置文件 (`src/config/api.ts`)
包含所有API相关的全局配置：

- **API_CONFIG**: 基础配置（服务器地址、认证token等）
- **getAuthHeaders()**: 获取认证头信息
- **API_ENDPOINTS**: 所有API端点配置
- **buildApiUrl()**: 构建完整API URL的工具函数

### 2. API服务 (`src/services/api.ts`)
提供统一的API调用接口：

- **apiRequest()**: 通用API请求函数
- **algorithmApi**: 算法相关API操作
- **projectApi**: 项目相关API操作
- **resourceApi**: 资源相关API操作（JSON文件）

## 使用方法

### 在组件中使用API服务

```typescript
import { algorithmApi, projectApi, resourceApi } from "@/services/api";

// 获取算法列表
const algorithms = await algorithmApi.getList();

// 获取项目信息
const project = await projectApi.getById(projectId);

// 获取资源数据
const robots = await resourceApi.getRobots();
```

### 修改配置

要修改API配置，只需编辑 `src/config/api.ts` 文件：

```typescript
export const API_CONFIG = {
  baseUrl: 'http://your-api-server.com',
  authToken: 'your-new-token',
};
```

## 优势

1. **集中管理**: 所有API配置集中在一个地方
2. **类型安全**: 完整的TypeScript类型支持
3. **统一接口**: 所有API调用使用相同的模式
4. **易于维护**: 修改配置只需更新一个文件
5. **错误处理**: 统一的错误处理机制
