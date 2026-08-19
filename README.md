# 机器人云边协同调度平台

这是一个基于 React、Vite 和 TypeScript 的机器人任务编排前端。仓库内提供了一个轻量化、Cube Studio 接口风格兼容的 Node.js 后端，可在没有 Kubernetes、GPU 集群和 MQTT 服务的电脑上完成本地演示。

## 快速启动

Windows 上已经完成过本地 Docker/kind 环境初始化时，可以直接双击
[`start-cloud-bot-flow.bat`](start-cloud-bot-flow.bat)。电脑关机再开机后，该脚本会启动
Docker Desktop、恢复 Registry/kind、启动两套 MinIO、构建并启动网站。命令行运行时可传入
`--no-browser` 禁止自动打开浏览器。

也可以手动执行：

```powershell
npm install
npm run minio:up
npm run build
npm start
```

打开 <http://127.0.0.1:3001>。

本地账号：

- 管理员：`admin` / `admin123`
- 演示用户：`demo` / `demo123`

`npm start` 使用轻量后端同时提供 API 和已经构建好的前端。如果修改了前端代码，请重新运行 `npm run build`。

## 开发模式

```powershell
npm install
npm run dev:all
```

开发页面位于 <http://127.0.0.1:8080>，Vite 会把 `/api/cube` 代理到本地后端的 `3001` 端口。

## 已实现的本地功能

- 本地账号登录和路由鉴权
- 机器人、任务、算法、数据集资源读取和持久化 CRUD
- 任务、机器人、算法拖拽编排
- 算法拓扑顺序执行与本地模拟部署
- 工作流执行后跳转实时监控
- 本地机器人训练场
- 本地 3D 机器人查看器
- AI-Design 整机方案演示
- AI-Design 上下半身各 12 个部件生成与机器人拼接
- 模型示意图生成接口
- 私域算法代码资产登记
- Docker 仿真算法镜像库
- 6 个经过仓库与 commit 校验的 GitHub 开源机器人算法规格
- 仿真启动前 ROS Topic / 镜像规格预检
- 容器拖拽式机器人仿真实验室
- 工作流执行后自动进入仿真并带入算法链
- Cube Studio 风格的代码版本、镜像构建和镜像仓库管理
- 镜像摘要锁定、Pipeline 状态机和 MinIO 运行产物归档

后端数据保存在 `backend/data.json`，重新启动后仍会保留资源修改和部署记录。

算法库与真实仿真平台的生产化设计见
[`docs/algorithm-simulation-platform.md`](docs/algorithm-simulation-platform.md)。

零基础页面说明、3 条已跑通闭环的逐步操作、验收证据和术语表见
[`docs/closed-loop-user-guide.md`](docs/closed-loop-user-guide.md)。

镜像构建、Pipeline 与 MinIO 的配置和证据边界见
[`docs/cube-studio-platform.md`](docs/cube-studio-platform.md)。

## 切换真实 Cube Studio 或外部服务

后端接入 Cube Studio/MinIO 时复制 `.env.example` 为 `.env`；前端接入外部服务时可把
`VITE_*` 配置放入 `.env.local`。配置 `VITE_API_BASE_URL` 后，前端会使用外部 API/MQTT
服务。

主要接口兼容路径：

- `/login/`
- `/images_modelview/api/`
- `/project_modelview/api/`
- `/dataset_modelview/api/`
- `/pipeline_modelview/api/`
- `/docker_modelview/api/`
- `/repository_modelview/api/`
- `/pipeline_modelview/api/run_pipeline/<id>`
- `/robot_modelview/api/`
- `/deploy`

## 检查命令

```powershell
npm run build
npx tsc -p tsconfig.app.json --noEmit
```

项目原有 ESLint 配置会对历史代码中的 `any` 和部分 shadcn/ui 模板写法报错，但不影响 TypeScript 检查、构建或运行。
