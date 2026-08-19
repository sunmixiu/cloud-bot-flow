import https from "node:https";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const kubeconfigPath = path.resolve(
  process.env.KUBECONFIG || path.join(os.homedir(), ".kube", "config")
);

let cachedConnection = null;

async function loadConnection() {
  if (cachedConnection) return cachedConnection;
  const kubeconfig = YAML.parse(await readFile(kubeconfigPath, "utf8"));
  const currentContext = kubeconfig.contexts?.find(
    (item) => item.name === kubeconfig["current-context"]
  )?.context;
  const cluster = kubeconfig.clusters?.find(
    (item) => item.name === currentContext?.cluster
  )?.cluster;
  const user = kubeconfig.users?.find((item) => item.name === currentContext?.user)?.user;
  if (!cluster?.server || !user?.["client-certificate-data"] || !user?.["client-key-data"]) {
    throw new Error(`kubeconfig ${kubeconfigPath} 缺少当前集群的连接信息`);
  }
  cachedConnection = {
    server: cluster.server,
    ca: cluster["certificate-authority-data"]
      ? Buffer.from(cluster["certificate-authority-data"], "base64")
      : undefined,
    cert: Buffer.from(user["client-certificate-data"], "base64"),
    key: Buffer.from(user["client-key-data"], "base64")
  };
  return cachedConnection;
}

async function kubernetesRequest(pathname, options = {}) {
  const connection = await loadConnection();
  const url = new URL(pathname, connection.server);
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method || "GET",
        ca: connection.ca,
        cert: connection.cert,
        key: connection.key,
        rejectUnauthorized: true,
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": options.contentType || "application/json",
                "Content-Length": Buffer.byteLength(body)
              }
            : {})
        },
        timeout: Number(process.env.KUBERNETES_API_TIMEOUT_MS || 10000)
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch {
            payload = text;
          }
          if ((response.statusCode || 500) >= 400) {
            reject(
              new Error(
                `Kubernetes API ${options.method || "GET"} ${pathname} 返回 ${response.statusCode}: ${
                  typeof payload === "string" ? payload.slice(0, 240) : payload?.message || JSON.stringify(payload)
                }`
              )
            );
            return;
          }
          resolve(payload);
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("Kubernetes API 请求超时")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export const kubernetesClient = {
  async health() {
    try {
      const result = await kubernetesRequest("/readyz");
      return { reachable: true, ready: true, endpoint: "kubernetes-api", result };
    } catch (error) {
      return {
        reachable: false,
        ready: false,
        endpoint: "kubernetes-api",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  },

  async createWorkflow(manifestPath) {
    const resource = YAML.parse(await readFile(manifestPath, "utf8"));
    if (resource?.apiVersion !== "argoproj.io/v1alpha1" || resource?.kind !== "Workflow") {
      throw new Error("仅允许提交 argoproj.io/v1alpha1 Workflow 清单");
    }
    const namespace = resource.metadata?.namespace || "pipeline";
    return kubernetesRequest(
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/workflows`,
      { method: "POST", body: resource }
    );
  },

  getWorkflow(namespace, name) {
    return kubernetesRequest(
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/workflows/${encodeURIComponent(name)}`
    );
  },

  deleteWorkflow(namespace, name) {
    return kubernetesRequest(
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/workflows/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        body: { propagationPolicy: "Background" }
      }
    );
  }
};
