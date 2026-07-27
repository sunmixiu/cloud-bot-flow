import { spawn } from "node:child_process";

// 同时启动：本地适配层(3001) + Vite(8080)
// 适配层把镜像构建/仓库/Pipeline 转发到真实 Cube Studio，产物写入 MinIO
const children = [
  spawn(process.execPath, ["backend/server.mjs"], {
    stdio: "inherit",
    env: { ...process.env }
  }),
  spawn("npm", ["run", "dev"], { stdio: "inherit", shell: true })
];

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exitCode = code;
    }
  });
}
