import "dotenv/config";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as Minio from "minio";

const trimSlash = (value) => String(value || "").replace(/\/+$/, "");

function parseMinioEndpoint(value) {
  if (!value) return null;
  const normalized = value.includes("://") ? value : `http://${value}`;
  const url = new URL(normalized);
  return {
    endPoint: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 9000)),
    useSSL: url.protocol === "https:",
    publicUrl: `${url.protocol}//${url.host}`
  };
}

const cubeStudioBaseUrl = trimSlash(process.env.CUBE_STUDIO_BASE_URL);
const cubeStudioToken = String(process.env.CUBE_STUDIO_TOKEN || "");
const minioEndpoint = parseMinioEndpoint(process.env.MINIO_ENDPOINT);
const cubeMinioEndpoint = parseMinioEndpoint(process.env.CUBE_MINIO_ENDPOINT);
const minioBucket = String(process.env.MINIO_BUCKET || "mlpipeline");
const localArtifactDir = path.resolve(
  process.env.LOCAL_ARTIFACT_DIR || path.join(process.cwd(), "backend", "artifacts")
);

const minioClient = minioEndpoint
  ? new Minio.Client({
      endPoint: minioEndpoint.endPoint,
      port: minioEndpoint.port,
      useSSL: minioEndpoint.useSSL,
      accessKey: String(process.env.MINIO_ACCESS_KEY || "minio"),
      secretKey: String(process.env.MINIO_SECRET_KEY || "minio123"),
      region: String(process.env.MINIO_REGION || "us-east-1")
    })
  : null;

const cubeMinioClient = cubeMinioEndpoint
  ? new Minio.Client({
      endPoint: cubeMinioEndpoint.endPoint,
      port: cubeMinioEndpoint.port,
      useSSL: cubeMinioEndpoint.useSSL,
      accessKey: String(process.env.CUBE_MINIO_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || "minio"),
      secretKey: String(process.env.CUBE_MINIO_SECRET_KEY || process.env.MINIO_SECRET_KEY || "minio123"),
      region: String(process.env.CUBE_MINIO_REGION || process.env.MINIO_REGION || "us-east-1")
    })
  : null;

async function withTimeout(callback, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await callback(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function cubeRequest(pathname, options = {}) {
  if (!cubeStudioBaseUrl) {
    throw new Error("尚未配置 CUBE_STUDIO_BASE_URL");
  }
  const response = await withTimeout(
    (signal) =>
      fetch(`${cubeStudioBaseUrl}${pathname}`, {
        redirect: "manual",
        signal,
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          // cube-studio AUTH_PLATFORM_ACCESS：短 token 直接作为用户名；长 token 按 Bearer JWT
          ...(cubeStudioToken
            ? {
                Authorization:
                  cubeStudioToken.length < 40 || cubeStudioToken.startsWith("Bearer ")
                    ? cubeStudioToken.replace(/^Bearer\s+/i, "")
                    : `Bearer ${cubeStudioToken}`
              }
            : {}),
          ...(options.headers || {})
        }
      }),
    Number(process.env.CUBE_STUDIO_TIMEOUT_MS || 8000)
  );
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(
      `Cube Studio ${pathname} 返回 ${response.status}: ${
        typeof payload === "string" ? payload.slice(0, 180) : JSON.stringify(payload)
      }`
    );
  }
  return {
    status: response.status,
    location: response.headers.get("location"),
    payload
  };
}

export const cubeStudio = {
  configured: Boolean(cubeStudioBaseUrl),

  async health() {
    if (!cubeStudioBaseUrl) {
      return {
        configured: false,
        reachable: false,
        mode: "local-compatible",
        endpoint: null,
        message: "未配置真实 Cube Studio，当前使用本地兼容执行器"
      };
    }
    try {
      // Prefer explicit health path; fall back to a lightweight authenticated API
      const healthPath = String(process.env.CUBE_STUDIO_HEALTH_PATH || "/health");
      try {
        await cubeRequest(healthPath);
      } catch {
        await cubeRequest("/project_modelview/api/");
      }
      return {
        configured: true,
        reachable: true,
        mode: "cube-studio",
        endpoint: cubeStudioBaseUrl,
        message: "Cube Studio 可访问（镜像构建/仓库/Pipeline 将转发到该实例）"
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        mode: "cube-studio",
        endpoint: cubeStudioBaseUrl,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  },

  async listDockerBuilds() {
    return cubeRequest("/docker_modelview/api/");
  },

  async createDockerBuild(input) {
    const projectId = input.project_id || Number(process.env.CUBE_STUDIO_PROJECT_ID || 1);
    return cubeRequest("/docker_modelview/api/", {
      method: "POST",
      body: JSON.stringify({
        project: projectId,
        describe: input.description,
        base_image: input.base_image,
        target_image: input.target_image,
        consecutive_build: true,
        expand: JSON.stringify({
          resource_cpu: String(input.resource_cpu || "2"),
          resource_memory: String(input.resource_memory || "4G"),
          source_repository: input.repository_url,
          source_ref: input.source_ref
        })
      })
    });
  },

  async listRepositories() {
    return cubeRequest("/repository_modelview/api/");
  },

  async createRepository(input) {
    return cubeRequest("/repository_modelview/api/", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        server: input.server,
        user: input.user,
        password: input.password,
        hubsecret: input.hubsecret
      })
    });
  },

  async listImages() {
    return cubeRequest("/images_modelview/api/");
  },

  async listWorkflows() {
    return cubeRequest("/workflow_modelview/api/");
  },

  async runPipeline(pipelineId) {
    return cubeRequest(`/pipeline_modelview/api/run_pipeline/${encodeURIComponent(pipelineId)}`, {
      method: "POST",
      body: "{}"
    });
  }
};

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function ensureMinioBucket() {
  if (!minioClient) throw new Error("MinIO 未配置");
  const exists = await minioClient.bucketExists(minioBucket);
  if (!exists) {
    await minioClient.makeBucket(
      minioBucket,
      String(process.env.MINIO_REGION || "us-east-1")
    );
  }
}

export const artifactStore = {
  configured: Boolean(minioClient),

  async health() {
    if (!minioClient) {
      await mkdir(localArtifactDir, { recursive: true });
      return {
        configured: false,
        reachable: true,
        provider: "local-filesystem",
        endpoint: localArtifactDir,
        bucket: null,
        message: "未配置 MinIO，产物写入本地兼容存储"
      };
    }
    try {
      await minioClient.bucketExists(minioBucket);
      return {
        configured: true,
        reachable: true,
        provider: "minio",
        endpoint: minioEndpoint.publicUrl,
        bucket: minioBucket,
        message: "MinIO 可访问"
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        provider: "minio",
        endpoint: minioEndpoint.publicUrl,
        bucket: minioBucket,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  },

  async putJson(objectName, value) {
    const payload = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (minioClient) {
      try {
        await ensureMinioBucket();
        const result = await minioClient.putObject(
          minioBucket,
          objectName,
          payload,
          payload.length,
          { "Content-Type": "application/json" }
        );
        return {
          provider: "minio",
          bucket: minioBucket,
          object_key: objectName,
          size: payload.length,
          etag: result.etag || null
        };
      } catch (error) {
        if (process.env.MINIO_STRICT === "true") throw error;
      }
    }

    const localPath = path.join(localArtifactDir, ...objectName.split("/"));
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, payload);
    return {
      provider: minioClient ? "local-fallback" : "local-filesystem",
      bucket: null,
      object_key: objectName,
      local_path: localPath,
      size: payload.length,
      etag: null
    };
  },

  async readObject(artifact) {
    if (artifact.storage?.provider === "cube-minio" && cubeMinioClient) {
      return streamToBuffer(
        await cubeMinioClient.getObject(minioBucket, artifact.storage.object_key)
      );
    }
    if (artifact.storage?.provider === "minio" && minioClient) {
      return streamToBuffer(
        await minioClient.getObject(minioBucket, artifact.storage.object_key)
      );
    }
    const localPath =
      artifact.storage?.local_path ||
      path.join(localArtifactDir, ...String(artifact.storage?.object_key || "").split("/"));
    return readFile(localPath);
  },

  async readKey(objectName) {
    if (minioClient) {
      return streamToBuffer(await minioClient.getObject(minioBucket, objectName));
    }
    return readFile(path.join(localArtifactDir, ...String(objectName).split("/")));
  },

  async readWorkflowKey(objectName) {
    if (cubeMinioClient) {
      return streamToBuffer(await cubeMinioClient.getObject(minioBucket, objectName));
    }
    return this.readKey(objectName);
  },

  async inspectLocalObject(artifact) {
    if (!artifact.storage?.local_path) return null;
    const details = await stat(artifact.storage.local_path);
    return {
      size: details.size,
      modified_at: details.mtime.toISOString()
    };
  }
};

export function platformConfiguration() {
  return {
    cube_studio: {
      mode: cubeStudioBaseUrl ? "cube-studio" : "local-compatible",
      endpoint: cubeStudioBaseUrl || null,
      project_id: Number(process.env.CUBE_STUDIO_PROJECT_ID || 1),
      api: {
        image_builds: "/docker_modelview/api/",
        repositories: "/repository_modelview/api/",
        pipeline_run: "/pipeline_modelview/api/run_pipeline/<id>"
      }
    },
    artifact_store: {
      provider: minioClient ? "minio" : "local-filesystem",
      endpoint: minioEndpoint?.publicUrl || localArtifactDir,
      bucket: minioClient ? minioBucket : null
    }
  };
}
