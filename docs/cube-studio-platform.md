# Cube Studio 镜像构建、Pipeline 与 MinIO 接入

## 已实现链路

系统新增“镜像与 Pipeline”工作台，链路如下：

1. 从代码资产库选择仓库与分支/Commit。
2. 创建不可变构建清单，并提交镜像构建。
3. 以镜像摘要登记镜像资产。
4. 选择镜像和 Pipeline，创建运行记录。
5. 将运行结果写入 MinIO 的 `mlpipeline` Bucket，并允许从界面下载。

后端适配的 Cube Studio 路由：

- 镜像构建记录：`/docker_modelview/api/`
- 镜像仓库：`/repository_modelview/api/`
- Pipeline 运行：`/pipeline_modelview/api/run_pipeline/<id>`

## 本地联调

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

启动 MinIO：

```powershell
docker compose -f docker-compose.minio.yml up -d
```

启动系统：

```powershell
npm run build
npm start
```

MinIO API 为 `http://127.0.0.1:9000`，控制台为
`http://127.0.0.1:9001`。

若 Docker/MinIO 不可用，后端会把产物写入 `backend/artifacts`，并在界面明确显示
`local-filesystem` 或 `local-fallback`，不会把本地联调证据标记为真实容器执行结果。

## 接入真实 Cube Studio

在 `.env` 中设置：

```dotenv
CUBE_STUDIO_BASE_URL=https://cube.example.com
CUBE_STUDIO_TOKEN=<service-account-token>
CUBE_STUDIO_PROJECT_ID=1

MINIO_ENDPOINT=https://minio.example.com
MINIO_ACCESS_KEY=<access-key>
MINIO_SECRET_KEY=<secret-key>
MINIO_BUCKET=mlpipeline
MINIO_STRICT=true
```

真实模式下：

- 创建仓库配置会调用 Cube Studio Repository API，并由 Cube Studio 同步 K8s
  `hubsecret`。
- 创建镜像构建会登记 Cube Studio Docker 记录。Cube Studio 当前的标准机制仍要求用户
  启动调试容器、安装环境，然后执行“保存”以 commit/push 目标镜像。
- Pipeline 运行会调用 Cube Studio 的运行入口，由其生成并提交 Argo Workflow。
- `MINIO_STRICT=true` 时 MinIO 写入失败会让归档失败，不再降级到本地文件。

## 证据边界

本地兼容模式用于验证前后端 API、任务状态机、镜像摘要追踪和产物归档，不能替代真实
Docker 构建、Kubernetes 调度、ROS 2 节点运行或 Gazebo 仿真。界面中的
`evidence_level`、`runtime_verified` 和 Provider 会区分两类结果。
