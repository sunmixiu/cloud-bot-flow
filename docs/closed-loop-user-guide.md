# 平台已实现闭环与页面使用手册

> 验收日期：2026-08-18（Asia/Shanghai）
>
> 适用目录：`cloud-bot-flow`，算法目录：同级 `algorithm`
> 本文面向第一次接触本项目的用户。文中的“已跑通”只指真实提交到 Kubernetes/Argo、由容器执行并把证据归档到 MinIO 的流程，不把前端动画或固定返回值当作成功。

## 1. 先认识这个平台

这个平台把机器人算法从“代码”变成“用户可以在页面上编排、运行、查看证据的能力”。一条完整链路是：

```text
算法源码与固定 Commit
        ↓
Docker/OCI 镜像（使用不可变 SHA-256 Digest）
        ↓
Pipeline / Argo Workflow 执行清单
        ↓
工作流画布选择任务、机器人和算法
        ↓
仿真实验室运行前预检
        ↓
Kubernetes 创建真实 Pod，容器执行算法
        ↓
算法结果、轨迹、图片、断言和校验和归档到 MinIO
        ↓
平台校验产物并在真实页面回放、展示和下载
```

这里有三个容易混淆的概念：

- **任务**说明“用户想完成什么”，例如“机械臂物理取放闭环”。在当前实现中，它对应一个 Pipeline。
- **机器人**说明“由哪类设备承担任务”，并参与能力与场景兼容性检查。
- **算法**说明“容器里实际执行什么”。只有绑定了不可变镜像 Digest 和真实 Argo Workflow 的算法才能点击运行。

## 2. 当前已跑通的真实闭环

截至 2026-08-18，本项目有且只有下面 3 条生产式可运行闭环。算法库里的其他条目属于源码案例、规格或待构建资产，不能把它们说成已经跑通。

| 闭环 | 画布链路 | 最新真实 Workflow | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 商品条码识别 | 便利店条码识别闭环 → 检测机器人-002 → 便利店商品条码识别 | `retail-barcode-closed-loop-4ptwb` | 成功，EAN-13 输入与识别结果一致 | MinIO TGZ，SHA-256 完整性通过 |
| 机械臂物理取放 | 机械臂物理取放闭环 → 装配机器人-003 → Bullet Panda 机械臂物理取放 | `physics-pick-place-jcfvf` | 成功，Bullet 刚体仿真与全部断言通过 | MinIO TGZ、轨迹、渲染帧和断言 |
| 便利店点云数字孪生 | 便利店点云重建与作业闭环 → 检测机器人-002 → 便利店点云数字孪生闭环 | `retail-digital-twin-hqjxk` | 传统算法基线成功；VLA 未接入并被明确阻断 | MinIO TGZ、PCD、OBJ、路径、预览和断言 |

三次最新执行均由 Argo 在 `pipeline` 命名空间创建真实 Workflow，页面状态为 `completed`，Workflow 状态为 `Succeeded`，证据校验通过且 `publishable=true`。

## 3. 第一次启动

### 3.1 只查看和管理页面

先安装并启动 Docker Desktop，确认 `docker version` 可以正常返回，然后在 PowerShell 中执行：

```powershell
cd D:\sun\shixi\ai\code-rep\cloud-bot-flow
npm install
npm run minio:up
npm run build
npm start
```

打开 <http://127.0.0.1:3001>，本地账号：

- 管理员：`admin` / `admin123`
- 演示用户：`demo` / `demo123`

修改前端代码后需要重新执行 `npm run build`，再刷新 `3001` 页面。开发时也可运行 `npm run dev:all`，前端地址为 <http://127.0.0.1:8080>。

### 3.2 运行本文的 3 条真实闭环

仅启动网页和 MinIO 不等于具备真实 Pipeline 运行环境，还需要：

1. Docker Desktop 正常运行。
2. 本地 OCI Registry 能从宿主机通过 `localhost:5001` 访问。
3. Kubernetes context 为 `kind-cube-studio`，集群可用。
4. `pipeline` 命名空间中已安装 Argo Workflows Controller。
5. `pipeline-runner` ServiceAccount 和所需 RBAC 已配置。
6. 集群内 MinIO 可用，Argo 能上传输出产物。
7. 三个镜像已推送到 Registry，且 Digest 与平台登记值一致。

快速检查：

```powershell
docker ps
kubectl config current-context
kubectl get nodes
kubectl get pods -n pipeline
kubectl get workflows -n pipeline
Invoke-RestMethod http://127.0.0.1:3001/health
```

本地 Kubernetes、Argo、Registry、MinIO 的搭建和验证记录见 [kubernetes-argo-minio-verification-2026-07-27.md](kubernetes-argo-minio-verification-2026-07-27.md)。

## 4. 在工作流画布上的统一操作方法

三条闭环的页面操作骨架相同：

1. 登录后进入左侧 **任务工作流**。
2. 在左侧 **组件库**展开“任务”“机器人”“算法”。算法下还需要展开项目分组。
3. 把本闭环指定的任务拖到画布左侧，把机器人拖到中间，把算法拖到右侧。
4. 鼠标悬停在任务节点上，按住节点右侧出现的 `+`，拖到机器人节点后松开。
5. 再从机器人节点右侧的 `+` 拖到算法节点。
6. 确认箭头方向是 `任务 → 机器人 → 算法`。反向连接、孤立节点和算法环路都会被拒绝。
7. 点击右上角 **进入仿真实验室**，在确认框点击 **检查并进入**。
8. 实验室应显示已绑定的 Pipeline、机器人、算法和不可变镜像，不要在这里临时换成另一个源码案例。
9. 选择或确认场景后点击 **运行前检查**。只有兼容性、镜像、输入输出和 Workflow 检查全部通过，运行按钮才可用。
10. 点击 **运行真实 Pipeline**。页面会显示提交、Pod 执行、取回产物、完整性校验等阶段。
11. 状态变为“已完成”后检查三个位置：结果指标、断言列表、MinIO 产物与完整性状态。
12. 需要复核时点击下载产物；历史运行可从实验室左侧/下方的运行历史重新打开。

注意：直接从地址栏打开 `/simulation` 时没有画布传入的 Pipeline 绑定，因此运行按钮被禁用是设计行为，不是故障。

## 5. 闭环一：便利店商品条码识别

### 5.1 解决什么问题

把便利店相机图片中的 EAN/UPC、Code 128 或二维码识别能力封装成可部署算法。本次验收使用标准 EAN-13 `4006381333931`，容器先生成输入图片，再调用 ZXing-C++ 解码，然后执行“识别值必须等于期望值”的自动断言。

这不是前端随机生成的识别结果：图片生成、解码和断言都在 Kubernetes Pod 中完成。

### 5.2 画布流程

```text
便利店条码识别闭环
    → 检测机器人-002
    → 便利店商品条码识别
```

推荐使用检测机器人是因为它登记了视觉传感器能力。运行前检查会确认 Pipeline 的 `algorithm_ids` 中确实包含该算法，防止页面选择和实际运行镜像不一致。

### 5.3 容器内部流程

```text
生成 input.png
    → ZXing-C++ 读取并解码
    → 写入 result.json
    → 比较 expected 与 detected
    → 写入 closed-loop.json
    → 生成 SHA256SUMS
    → Argo 上传 closed-loop-evidence.tgz 到 MinIO
    → 平台下载、解包、校验并显示结果
```

主要交付物：`input.png`、`result.json`、`closed-loop.json`、`SHA256SUMS`。

### 5.4 最新验收证据

- 平台运行 ID：`sim-cde2460a-7e6d-48c9-b74c-3faca50beb87`
- Argo Workflow：`retail-barcode-closed-loop-4ptwb`
- 镜像：`localhost:5001/cloud-bot-flow/retail-barcode-scanner@sha256:6628e568e0c563a50e9fc9c201c57d983fcda2f11703ad93ea8ba49259794f02`
- 输入/输出：`4006381333931 → 4006381333931`
- 格式：EAN-13
- 算法耗时：49.336 ms（页面按 49.34 ms 显示）
- 检出数：1
- MinIO 对象：`retail-barcode-closed-loop-4ptwb/retail-barcode-closed-loop-4ptwb/closed-loop-evidence.tgz`
- 结论：Workflow `Succeeded`，断言、证据完整性和发布条件均通过。

源文件位于同级目录 `algorithm/retail-barcode-scanner/`。

## 6. 闭环二：Bullet Panda 机械臂物理取放

### 6.1 解决什么问题

在 Bullet 真实刚体求解器中加载 Franka Panda、操作台、刚体工件和目标区域，执行接近、抓取、搬运、放置和撤离。它包含逆运动学、关节位置控制、动力学步进、抓取约束、碰撞/安全检查和相机渲染，不是用 CSS 让机械臂图标移动。

### 6.2 画布流程

```text
机械臂物理取放闭环
    → 装配机器人-003
    → Bullet Panda 机械臂物理取放
```

使用装配机器人是因为该链路要求 `manipulator`（机械臂）能力；移动底盘不应通过该预检。

### 6.3 容器内部流程

```text
PyBullet DIRECT 启动物理世界
    → 加载 Panda、桌面、物体和目标区
    → IK 计算与关节控制
    → 刚体动力学步进和抓取约束
    → 接触、关节限位、目标误差检查
    → 生成轨迹与相机渲染帧
    → 全部断言通过后返回成功
    → Argo 上传证据到 MinIO
    → 页面加载轨迹并用 WebGL 回放遥测
```

主要交付物：`simulation-run.json`、`trajectory.json`、`preview.png`、`frames/frame-000.png` 至 `frame-010.png`、`SHA256SUMS.json`。

### 6.4 最新验收证据

- 平台运行 ID：`sim-9181d96b-b1df-458f-b357-6a5050928d2c`
- Argo Workflow：`physics-pick-place-jcfvf`
- 引擎：Bullet Physics / PyBullet 3.2.7，TinyRenderer
- 镜像：`localhost:5001/cloud-bot-flow/physics-pick-place@sha256:3f5bfdbabe283952d4d9579edbefe37242f56b3b479f0bd22282e251fa445846`
- 物体搬运距离：0.326451 m
- 最终目标误差：0.000191 m，约 0.19 mm
- 物理仿真时长：4.2083 s
- 实时因子 RTF：0.782
- 容器相机渲染：11 帧；页面轨迹插值/遥测关键帧：144 帧。两者是不同概念。
- 安全违规步骤：0
- 断言：到达目标、完成搬运、遵守关节限位、无强力碰撞，全部为真。
- MinIO 对象：`physics-pick-place-jcfvf/physics-pick-place-jcfvf/closed-loop-evidence.tgz`
- 结论：Workflow `Succeeded`，物理断言、证据完整性和发布条件均通过。

源文件位于同级目录 `algorithm/physics-pick-place/`。

## 7. 闭环三：便利店点云数字孪生与传统作业基线

### 7.1 解决什么问题

把便利店 ASCII PCD 点云转成 OBJ Mesh，并从点云投影出占据栅格，继续完成几何目标识别、A* 导航、差速底盘轨迹展开和传统解析 IK 可达性验证。页面从 MinIO 读取 OBJ、栅格和路径进行可交互回放。

这条链路对应当前提出的分层算法方向：

- 感知：PCD 读取、点云转 Mesh、几何结构识别。
- 任务层：当前使用确定性任务图；真实 LLM 任务拆解服务尚未接入。
- 控制下层：占据栅格、障碍膨胀、A* 路径和差速运动学轨迹。
- 上半身：传统解析 IK 可达性验证。
- VLA 抓取：尚未接入；平台显示 `blocked`，不会伪造成功结果。

### 7.2 画布流程

```text
便利店点云重建与作业闭环
    → 检测机器人-002
    → 便利店点云数字孪生闭环
```

当前基线用移动底盘完成场景感知与导航，并验证传统抓取目标的几何可达性。若以后接入实际移动操作机器人，应在资源管理中登记对应底盘、机械臂、传感器、ROS Topic 和标定信息，再调整兼容性规格。

### 7.3 容器内部流程

```text
读取 ASCII PCD（当前默认 fixture://convenience-store-v1）
    → 点云体素化并生成 OBJ Mesh
    → 几何识别货架/柜台等结构
    → 生成并膨胀占据栅格
    → A* 搜索无碰撞路线
    → 展开差速底盘轨迹
    → 执行传统解析 IK 可达性检查
    → 记录 VLA 缺失项和 full_stack_ready=false
    → 生成 SHA-256 校验和并归档 MinIO
    → 页面加载 Mesh、路径、识别和 IK 证据
```

主要交付物：`retail-store.pcd`、`retail-store.obj`、`navigation-trajectory.json`、`preview.png`、`retail-run.json`、`SHA256SUMS.json`。

### 7.4 最新验收证据

- 平台运行 ID：`sim-05b9c7f0-0b61-48a6-b9f7-6fd23e803cfd`
- Argo Workflow：`retail-digital-twin-hqjxk`
- 镜像：`localhost:5001/cloud-bot-flow/retail-digital-twin@sha256:64ac7fa30ec420f3bc8e27f18ea635787e0b092d7c75ca6732601c5575097f5e`
- 点云：31,780 点
- Mesh：35,248 面
- 几何识别：5 个目标
- A* 路径：6.414 m，无碰撞
- 传统 IK：可达
- VLA：`blocked`
- `full_stack_ready=false`
- 断言：PCD 解析、Mesh 生成、结构识别、路径求解、无碰撞、传统抓取可达，全部通过。
- MinIO 对象：`retail-digital-twin-hqjxk/retail-digital-twin-hqjxk/closed-loop-evidence.tgz`
- 结论：传统算法基线 `Succeeded` 且可发布；不能据此宣称 LLM/VLA/真实机器人全栈已完成。

源文件位于同级目录 `algorithm/retail-digital-twin/`。接软件组真实点云时，把 ASCII PCD 挂载到容器并传入 `--input-pcd /input/store.pcd`；当前仓库中还没有软件组的真实便利店点云，所以默认使用可复现的便利店基准点云。

## 8. 每个页面的作用

| 左侧菜单 / 路径 | 页面作用 | 新用户通常做什么 | 当前真实性边界 |
| --- | --- | --- | --- |
| 登录 `/login` | 身份验证和路由保护 | 输入账号密码进入平台 | 本地模式使用本地用户；生产环境必须设置密码或接企业认证 |
| 任务工作流 `/` | 用任务、机器人、算法节点搭建拓扑 | 拖入节点、连接、检查并进入实验室 | 会把真实 Pipeline 和算法绑定传给实验室；画布本身不执行算法 |
| 实时监控 `/monitoring` | 显示机器人状态、环境数据和视频通道 | 从已执行工作流进入，查看传入的监控上下文 | 默认是本地轻量监控页；设置 `VITE_MONITORING_URL` 后可接真实监控系统 |
| 算法资产库 `/algorithm-library` | 管理源码资产与 Docker 仿真算法 | 查看仓库、Commit、许可证、镜像、接口和构建状态 | “源码已验证”不等于“镜像可运行”；只有带 Digest 和 Workflow 的资产可进真实闭环 |
| 镜像与 Pipeline `/build-pipeline` | 管理代码版本、镜像构建、Registry、Pipeline 运行和产物 | 创建构建、登记摘要镜像、启动 Pipeline、下载产物 | 本地/真实 Cube Studio 模式取决于配置；本文 3 条闭环使用真实 Argo 清单 |
| 仿真实验室 `/simulation` | 预检、提交、停止、查看进度、回放结果、下载证据 | 从画布进入，先预检再运行 | 只接受真实 Pipeline；不会在页面生成假轨迹或假性能数字 |
| 性能报告 `/reports` | 展示趋势、机器人对比和最近任务布局 | 了解报表界面和计划中的指标维度 | **当前数据是源码中的静态 Mock 数据，尚未连接真实运行数据库，不能用作验收报告** |
| 资源管理 `/resources` | 机器人、任务、算法、数据集的 CRUD 管理 | 新增、查看、编辑或删除资产元数据 | 数据写入 `backend/data.json`；删除会影响组件库，操作前确认依赖关系 |
| 机器人训练场 `/training` | 展示仓储搬运场景和训练控制入口 | 体验训练流程或接入外部训练平台 | 默认是本地可交互轻量演示；设置 `VITE_TRAINING_URL` 后接真实服务 |
| 3D 查看器 `/viewer` | 查看机器人模型和基本三维信息 | 预览模型、检查渲染是否工作 | 默认是本地轻量预览；设置 `VITE_ROBOT_VIEWER_URL` 后接真实查看器 |
| 404 | 处理不存在的地址 | 返回有效菜单页面 | 不承载业务功能 |

### 8.1 算法资产库中的两个页签

- **代码资产库**：登记 Git 仓库、分支或 Commit、许可证、负责人、入口命令和 Dockerfile。它回答“代码来自哪里、能否复现”。
- **仿真算法库**：登记运行镜像、模块、输入输出 Topic、兼容机器人和场景。它回答“这个算法能否被平台调度”。

### 8.2 镜像与 Pipeline 页面中的四段链路

1. **代码版本**：锁定仓库与 Commit，避免后来代码变化导致结果不可复现。
2. **镜像构建**：把代码和依赖打包成 OCI 镜像。
3. **镜像仓库**：保存镜像，生产运行应使用 `@sha256:...`，不要只使用会漂移的标签。
4. **Pipeline 与产物**：用 DAG/Argo 描述执行顺序，把结果归档并提供下载。

### 8.3 仿真实验室中的主要区域

- **运行模板/资产链**：显示从画布带入的 Pipeline、算法和镜像。
- **场景与机器人**：决定传感器、机器人类型和空间约束是否兼容。
- **运行前检查**：验证镜像 Digest、Workflow、算法绑定、I/O、机器人和场景。
- **运行控制**：提交或停止真实 Argo Workflow。
- **进度与日志**：展示平台、集群和容器阶段，不代表业务结果本身。
- **证据与断言**：决定此次结果是否可信、是否可发布。
- **回放视窗**：条码显示输入/检测结果；物理取放显示 Bullet 轨迹；数字孪生显示真实产物中的 Mesh、路径和检测结果。
- **运行历史**：重新打开历史证据，不会重新生成动画数据。

## 9. 关键词解释

| 关键词 | 通俗解释 |
| --- | --- |
| 工作流 / Workflow | 一次任务由哪些步骤按什么顺序执行。画布上的箭头是业务拓扑，Argo Workflow 是集群实际执行清单。 |
| Pipeline | 可反复运行的一套任务模板，包含算法绑定、镜像和执行规则。 |
| DAG | 有向无环图；步骤有方向但不能形成循环依赖。 |
| Cube Studio | 上层算法开发与调度平台接口；本项目后端兼容其常用 API，并把真实运行交给 Argo/Kubernetes。 |
| Kubernetes / K8s | 负责创建、调度、隔离和回收算法容器的集群系统。 |
| Argo Workflows | 在 Kubernetes 上按 Workflow 清单运行容器任务并收集产物。 |
| Pod | Kubernetes 中的一次实际运行单元；算法容器就在 Pod 里执行。 |
| Namespace | Kubernetes 的逻辑隔离空间；本项目 Workflow 位于 `pipeline`。 |
| Docker / OCI 镜像 | 把程序、系统库和 Python 依赖一起封装的可执行包。 |
| Tag | 类似 `:1.0.0` 的易读名称，可能被同名覆盖。 |
| Digest | 类似 `@sha256:...` 的内容指纹；内容变化，Digest 必然变化，适合生产锁定。 |
| Commit | Git 中某一版源码的唯一标识，用来追溯镜像从哪一版代码构建。 |
| Schema | 输入或输出数据结构的机器可读约定，例如字段名、类型和必填项。 |
| EntryPoint | 容器启动后真正执行的命令。 |
| Registry | 存放和分发 OCI 镜像的仓库；当前本地地址为 `localhost:5001`。 |
| MinIO | S3 兼容对象存储，用来保存图片、轨迹、JSON、模型和压缩证据包。 |
| Artifact / 产物 | 一次运行留下的文件证据，不等同于日志。 |
| Evidence / 证据 | 产物、断言、时间、镜像摘要和校验结果的组合，可用于复核一次运行。 |
| SHA-256 | 文件或镜像的指纹算法；平台用它判断证据是否被改动。 |
| Assertion / 断言 | 自动判定成功的条件，例如条码相等、目标误差达标、路径无碰撞。 |
| Preflight / 运行前检查 | 在占用集群资源前先检查镜像、接口、机器人、场景和 Workflow 是否匹配。 |
| Compatibility Score | 兼容性评分；评分只是预检摘要，最终仍以 `runnable` 和错误列表为准。 |
| `publishable` | 当前闭环规定的断言和证据完整性通过，可以发布这次基线结果；不表示现实机器人全栈已经完成。 |
| `full_stack_ready` | 感知、规划、控制、模型服务、标定等完整系统是否都就绪。数字孪生当前为 `false`。 |
| `verified-source` | 仓库、Commit 或许可证等源码信息已核验；不代表已有可运行镜像。 |
| `build-required` | 还需要构建、推送和登记镜像，不能直接运行。 |
| `verified` 镜像 | 镜像摘要和运行规格已登记，但仍需预检确认 Pipeline、场景和机器人。 |
| Telemetry / 遥测 | 运行过程记录的位置、关节、速度或状态序列。 |
| Keyframe / 关键帧 | 回放轨迹的采样点；不一定等于相机实际渲染图片数量。 |
| Renderer | 把场景或轨迹绘制成图像的模块；TinyRenderer 是 Bullet 的软件渲染器，WebGL 用于浏览器交互回放。 |
| Point Cloud / 点云 | 由大量三维坐标点组成的环境数据。 |
| PCD | 常见点云文件格式；当前数字孪生入口要求 ASCII PCD，至少有 `x y z`。 |
| Mesh / OBJ | 由顶点和面构成的三维表面；OBJ 是本闭环输出的模型格式。 |
| Voxel / 体素 | 三维空间中的小立方格；可把离散点云整理成可渲染表面。 |
| Occupancy Grid / 占据栅格 | 把地图划成可通行和被障碍占据的格子，供路径规划使用。 |
| Inflation Radius / 膨胀半径 | 按机器人尺寸把障碍向外扩大，避免规划路线贴障碍过近。 |
| A* | 在栅格上搜索低代价路径的经典算法。 |
| IK / 逆运动学 | 给定末端目标位置，求机械臂各关节角。 |
| RTF | Real-Time Factor；仿真时间与现实耗时的比例，1 表示大致实时。 |
| ROS 2 Topic | ROS 2 节点之间传感器、控制和状态消息的命名通道。 |
| SLAM | 同时定位与建图。当前数字孪生基线没有运行在线 SLAM。 |
| Nav2 | ROS 2 导航栈。当前数字孪生使用自带 A* 与差速轨迹，不等同于 Nav2 控制器闭环。 |
| RTAB-Map | 常用视觉/激光 SLAM 与三维建图方案；当前仅有相关候选资产，不是本文已跑通链路。 |
| MoveIt 2 | ROS 2 机械臂运动规划框架；当前 Bullet 闭环使用自有 IK/控制，不等同于 MoveIt Pro。 |
| LLM | 大语言模型，可用于自然语言理解和任务拆解；当前真实服务未接入。 |
| VLA | Vision-Language-Action 模型，把视觉和语言指令映射为机器人动作；当前未接入，状态为 `blocked`。 |
| Seed | 随机种子；固定后相同算法和输入更容易复现。 |
| Fault Mode | 故障注入模式，用于测试超时、掉线等异常；生产 Argo 闭环当前不允许用假故障模式替代真实执行。 |

## 10. 状态应该怎么理解

### 10.1 资产状态

- `verified-source`：源码来源已核验。
- `build-required`：需要构建镜像。
- `verified`：镜像/规格已经登记，可继续参加预检。
- 带 `@sha256:`：运行内容已按摘要锁定。

### 10.2 运行状态

- `validating`：运行前检查中。
- `running`：真实 Workflow 已提交且仍在执行。
- `completed`：平台已取回结果并完成证据处理。
- `failed`：容器、Workflow、断言或证据处理失败。
- `canceling/canceled`：用户正在停止或已经停止真实 Workflow。
- `interrupted`：集群/服务中断导致本次运行未正常完成。

`completed` 仍需同时查看 Workflow 是否 `Succeeded`、断言是否全通过、完整性是否通过和 `publishable` 是否为真。

## 11. 常见问题

### 11.1 “运行真实 Pipeline”按钮是灰色

最常见原因是直接打开了仿真实验室，或画布中没有形成完整的 `任务 → 机器人 → 算法`。回到任务工作流，使用本文指定的三件套重新进入。

### 11.2 运行前检查失败

展开错误列表逐项处理。典型原因：

- 机器人类型与算法要求不一致，例如用移动底盘运行机械臂取放。
- 算法不是当前 Pipeline 的 `algorithm_ids` 成员。
- 镜像只有 Tag，没有不可变 Digest。
- 没有登记真实 `workflow_manifest`。
- 输入 Topic、场景或能力缺失。

### 11.3 Workflow 一直运行或镜像拉取失败

```powershell
kubectl get workflows -n pipeline
kubectl get pods -n pipeline
kubectl describe pod -n pipeline <Pod名称>
kubectl logs -n pipeline <Pod名称> -c main
docker ps
```

重点检查 Registry `localhost:5001` 是否同时能被宿主机和 kind 节点访问，以及 Manifest 中的 Digest 是否还存在。

### 11.4 Workflow 成功但页面没有证据

检查 Argo 输出中是否存在名为 `closed-loop-evidence` 的 artifact，并确认 MinIO 的 Endpoint、Access Key、Secret Key、Bucket 一致。默认 Bucket 为 `mlpipeline`。

### 11.5 页面显示 `VLA blocked`

这不是传统基线失败，而是平台明确告知 VLA 全栈尚未就绪。需要真实模型权重、GPU 推理服务、相机标定、动作 Schema 和安全策略后才能把它改为成功。

### 11.6 3D 回放打不开

先确认浏览器启用 WebGL，再看浏览器控制台和 `/simulation/runs/<run-id>/mesh`、`/preview` 等请求。页面不会用假动画替代无法读取的真实证据。

## 12. 当前不能对外宣称已经完成的部分

- 软件组真实便利店 PCD 尚未放入本工作区；数字孪生默认使用确定性的便利店 fixture 点云。
- 真实 LLM 任务拆解服务尚未接入。
- VLA 模型权重、GPU 推理、动作 Schema 与相机/机械臂标定尚未接入。
- 数字孪生导航当前为占据栅格 + A* + 差速运动学轨迹，不是 Gazebo/Isaac Sim 中的 Nav2 在线控制闭环。
- Bullet 取放是真实物理求解闭环，但不是 MoveIt Pro 或真实机械臂硬件在环。
- 性能报告页面仍是静态 Mock 数据。
- 监控、训练场和 3D 查看器默认是本地轻量页面；需要通过 `VITE_MONITORING_URL`、`VITE_TRAINING_URL`、`VITE_ROBOT_VIEWER_URL` 接真实服务。

## 13. 新增下一条真实算法闭环的最低交付清单

新增算法不能只在组件库增加一个名字，至少要同时交付：

1. 可追溯的源码仓库、固定 Commit 和许可证。
2. Dockerfile、锁定的依赖版本和可复现构建方式。
3. 推送到 Registry 的 OCI 镜像及不可变 Digest。
4. `algorithm.yaml` 或等价算法描述文件。
5. 输入/输出 Schema、单位、坐标系、Topic 和错误码。
6. 绑定该 Digest 的 Argo Workflow 清单。
7. 机器人类型、能力和场景兼容性规则。
8. 能真正决定成功/失败的断言，而不是固定返回 `success`。
9. 结果文件、日志、轨迹/图片/模型和 SHA-256 校验清单。
10. Argo 到 MinIO 的 artifact 输出，以及平台端读取和校验逻辑。
11. 工作流画布的任务/Pipeline/算法绑定。
12. 仿真实验室的结果解析、异常提示和真实数据回放。
13. 成功、失败、取消、超时、镜像拉取失败和证据损坏测试。
14. 一次从真实页面发起并由浏览器复核的验收记录。

## 14. 本次验收结论

2026-08-18 已重新运行条码识别、Bullet Panda 物理取放和便利店点云数字孪生三条闭环。三者都完成了“页面/平台提交 → Argo Workflow → Kubernetes Pod → 算法执行 → 自动断言 → MinIO 归档 → SHA-256 校验 → 页面展示/回放”的链路。

真实浏览器还逐页检查了任务工作流、算法资产库、镜像与 Pipeline、资源管理、仿真实验室、性能报告、实时监控、训练场和 3D 查看器，页面均能加载，浏览器控制台为 0 个错误。性能报告等尚未接真实数据的页面已在本文明确标注，不能把页面可打开等同于业务全栈已完成。
