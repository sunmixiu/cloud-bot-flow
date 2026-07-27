# Kubernetes、Argo 与 MinIO 真实执行验证

验证时间：2026-07-27（Asia/Shanghai）

## 结论

本地 `kind-cube-studio` 集群已经完成以下真实链路验证：

1. kind 节点的 containerd 从 `localhost:5001` 拉取业务镜像。
2. Argo Workflows 3.4.3 Controller 创建并调度真实 Workflow Pod。
3. init 与 wait 容器使用本地 Registry 中的
   `localhost:5001/argoproj/argoexec:v3.4.3`。
4. 主容器使用 `localhost:5001/cube-smoke:1.0`，退出码为 0。
5. Argo wait executor 将输出文件和主容器日志归档到集群内 MinIO。
6. 从 MinIO 重新读取并解包 Artifact 后，内容与本次 Workflow 一致。

## 运行对象

- Kubernetes Context：`kind-cube-studio`
- Kubernetes：`v1.31.4`
- Argo Workflow Controller：
  `ccr.ccs.tencentyun.com/cube-argoproj/workflow-controller:v3.4.3`
- Argo Executor：`localhost:5001/argoproj/argoexec:v3.4.3`
- MinIO：`minio/minio:RELEASE.2023-04-20T17-56-55Z`
- Workflow：`pipeline/cube-artifact-smoke-h454q`
- Workflow 状态：`Succeeded`
- Workflow Pod：`Completed`，init、wait 与 main 均为退出码 0

## Registry 证据

- Registry Pod 验证输出：`registry-pull-ok`
- 业务镜像：
  `localhost:5001/cube-smoke@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e`
- Executor 镜像：
  `localhost:5001/argoproj/argoexec@sha256:6e422f402f6b8d7f92202b7ccb512650a91fe7cf3cb9e201c719474ba805a0cf`

## MinIO 归档证据

Bucket：`mlpipeline`

对象：

- `cube-artifact-smoke-h454q/cube-artifact-smoke-h454q/runtime-evidence.tgz`
- `cube-artifact-smoke-h454q/cube-artifact-smoke-h454q/main.log`

`runtime-evidence.tgz`：

- 大小：239 bytes
- SHA-256：
  `53c0dad5ab4a960893240cc57a6304c7823d90e5d5a8b6bcb69be5af51640576`

解包内容：

```text
workflow=cube-artifact-smoke-h454q
namespace=pipeline
evidence_level=runtime-verified
image=localhost:5001/cube-smoke:1.0
registry=localhost:5001
artifact_store=minio.kubeflow:9000/mlpipeline
```

Argo wait executor 的上传日志包含：

```text
Saving file to s3
bucket=mlpipeline
endpoint=minio.kubeflow:9000
Save artifact ... error="<nil>"
Successfully saved file
```

## 已补充的项目文件

- `infrastructure/cube-studio-local/workflow-controller-executor-patch.yaml`
- `infrastructure/cube-studio-local/pipeline-runner-rbac.yaml`
- `infrastructure/cube-studio-local/workflow-artifact-smoke.yaml`

## 安全边界

Cube Studio 上游部署当前仍包含授予 `pipeline-runner` 全资源、全动作权限的
`ClusterRole/pipeline-runner` 与 `ClusterRoleBinding/pipeline-runner-binding`。
本次新增了命名空间级最小权限 Role，但未主动删除上游 ClusterRoleBinding，以免影响
Cube Studio 的跨命名空间 Pipeline 行为。生产化前应按实际工作流范围收紧该绑定。

本地 MinIO 账号仅用于隔离的开发集群；生产环境需要使用外部密钥管理、TLS、网络策略、
对象版本与保留策略。
