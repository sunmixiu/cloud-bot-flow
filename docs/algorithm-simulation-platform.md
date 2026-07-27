# 算法代码库与仿真平台设计

## 当前实现

当前仓库提供了一套可本地运行的 MVP：

1. 私域代码资产登记：算法名称、模块、语言、版本、负责人、Git 地址、分支和说明。
2. 仿真镜像登记：Docker 镜像、启动命令、运行时、输入输出 Topic。
3. 可执行资产发布：登记 Docker 镜像后，算法同时进入主工作流组件库和仿真算法库。
4. 编排演练：算法规格可以拖入或通过按钮加入运行链。
5. 服务端运行快照：后端状态机生成合成进度、事件和姿态，前端只轮询展示。
6. 工作流联动：主工作流先检查拓扑并生成仿真草稿，不会在预检前部署容器。
7. 严格契约预检：按算法 ID、版本、机器人类型/能力、场景和 ROS Topic 类型阻断不兼容组合。
8. 可复现实验清单：运行保存固定 seed、算法顺序、版本/commit、场景版本及 SHA-256。

## 已验证的 GitHub 上游目录

`backend/open-source-catalog.json` 固定记录了仓库、默认分支、许可证和验收时的
commit SHA，当前包含：

- SLAM Toolbox：二维建图与定位
- Navigation2：自主导航、规划与控制
- AprilTag ROS 2：视觉标签检测和位姿估计
- MoveIt 2：机械臂运动规划
- robot_localization：EKF/UKF 状态估计
- Open-RMF free_fleet：多机器人舰队接入和任务调度

这些上游以源码规格进入算法资产库、工作流组件库和仿真实验室。目录中的
`catalog.local/...` 是建议的内部镜像构建目标，不代表公开仓库已经提供该镜像。
当前仿真实验室只用于验证算法编排、接口契约、运行生命周期和监控 UI。它不执行
ROS 2 节点或物理引擎，因此碰撞、容器 CPU/内存和算法正确性均标记为“未测量”，
运行完成也不产生“可发布”结论。真实执行前必须由 CI 在受信任环境中构建、扫描并
签名镜像。

启动演练前，轻量后端会调用 `/simulation/preflight` 检查场景、机器人能力、
镜像定义、启动命令、ROS Topic 输入输出及消息类型。运行状态只允许通过后端控制
端点暂停、恢复和取消，客户端不能任意覆盖成功状态。

## 推荐的生产架构

```text
开发者
  │ push / merge request
  ▼
私域 Git（GitLab / Gitea）
  │ webhook
  ▼
CI 构建与测试
  │ docker build / SBOM / 签名
  ▼
私域镜像仓库（Harbor）
  │ 发布算法版本
  ▼
算法元数据服务
  │ 提供镜像、命令、Topic、资源需求、兼容机器人
  ├──────────────► 工作流编排器
  └──────────────► 仿真编排器
                         │
                         ▼
                 Docker / Kubernetes
                         │
              ROS 2 + Gazebo / Isaac Sim
                         │
                         ▼
              日志、指标、轨迹、视频回放
```

## 建议的算法包契约

每个算法仓库应提供一个 `algorithm.yaml`：

```yaml
name: slam-navigation
version: 2.1.0
module: perception-localization
image: harbor.local/robot/slam:2.1.0
command: ros2 launch robot_slam simulation.launch.py
runtime: ros2-humble
inputs:
  - topic: /scan
    type: sensor_msgs/msg/LaserScan
  - topic: /imu
    type: sensor_msgs/msg/Imu
outputs:
  - topic: /map
    type: nav_msgs/msg/OccupancyGrid
  - topic: /odom
    type: nav_msgs/msg/Odometry
resources:
  cpu: "2"
  memory: 4Gi
  gpu: 0
simulators:
  - gazebo
healthcheck:
  topic: /diagnostics
```

这个契约用于检查算法之间的 Topic 类型是否匹配、生成容器启动参数、计算资源需求，并选择合适的仿真器。

## 从 MVP 到真实仿真的迭代顺序

1. 接入 GitLab/Gitea 和 Harbor，实现真实代码推送、CI 构建和镜像版本管理。
2. 把当前内置的算法/机器人/场景契约迁移为版本化 `algorithm.yaml`、机器人清单和 world 清单。
3. 实现受限的 Docker Compose 执行器，在单机启动 ROS 2 算法容器并采集真实容器状态。
4. 接入 Gazebo Harmonic，读取真实 `/tf`、`/joint_states`、传感器、碰撞和相机数据。
5. 增加 rosbag、视频、日志、运行回放、任务指标和算法版本回归测试。
6. 增加镜像 digest/签名/SBOM、rootless 沙箱、配额、超时和网络隔离。
7. 需要多用户和 GPU 调度时，将执行器替换为 Kubernetes Jobs/Pods。

前端的运行快照模型可以继续复用，但真实执行器仍需补充异步 Job、readiness、取消、
断线恢复、遥测流和工件模型。
