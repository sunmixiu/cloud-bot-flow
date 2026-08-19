# 可编排算法

仓库内算法目录用于保存可复现构建、可作为 OCI 镜像交付、并可由 Cube Studio / Argo Workflows 调度的算法封装。

- `retail-apriltag-localization`：基于官方 AprilTag 3 的便利店货架/工位视觉标签检测与 6DoF 位姿估计闭环。

每个算法必须包含固定上游版本、许可证、输入输出 Schema、非 root 容器、不可变镜像工作流和可校验运行证据。
