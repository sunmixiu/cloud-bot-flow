# 本地 Cube Studio / Argo 集群

该目录用于在 Docker Desktop 上创建一个 Kubernetes 1.31 kind 集群。选择 1.31 是为了
满足 Cube Studio 官方声明的 Kubernetes 1.25–1.31 兼容范围。

本地端口：

- Cube Studio：`http://127.0.0.1:18080`
- 集群内 MinIO API：`http://127.0.0.1:19000`
- OCI Registry：`http://127.0.0.1:5001`
- Kubernetes API：`https://127.0.0.1:16443`

kind 节点挂载 Docker socket，仅用于本机研发环境中的 Cube Studio 镜像构建。不要把这
一配置直接用于生产环境。

## Argo、MinIO 与真实 Workflow 验证

Cube Studio 仓库自带的 Argo Workflows 3.4.3 使用 `kubeflow` 命名空间中的
`workflow-controller-configmap`，默认把日志与输出产物归档到
`minio.kubeflow:9000/mlpipeline`。

本地验证前需要完成：

```powershell
kubectl -n kubeflow create secret generic my-minio-cred `
  --from-literal=accesskey=minio `
  --from-literal=secretkey=minio123 `
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n pipeline create secret generic my-minio-cred `
  --from-literal=accesskey=minio `
  --from-literal=secretkey=minio123 `
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f infrastructure/cube-studio-local/pipeline-runner-rbac.yaml

kubectl -n kubeflow patch deployment workflow-controller `
  --type=strategic `
  --patch-file infrastructure/cube-studio-local/workflow-controller-executor-patch.yaml

kubectl create -f infrastructure/cube-studio-local/workflow-artifact-smoke.yaml
```

`argoexec:v3.4.3` 需要预先推送到 `localhost:5001/argoproj/argoexec:v3.4.3`。
测试 Workflow 使用已经通过 containerd 拉取验证的
`localhost:5001/cube-smoke:1.0`，并输出一个 `runtime-evidence` Artifact。

这里的 `minio/minio:RELEASE.2023-04-20T17-56-55Z` 与 `minio123` 仅用于隔离的
本机开发集群。生产环境必须使用独立密钥管理、TLS、网络策略与最小权限 RBAC。
