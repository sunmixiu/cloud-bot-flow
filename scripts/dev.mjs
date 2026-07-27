import { spawn } from "node:child_process";

// 仅启动 Vite；API 经 /api/cube 代理到真实 cube-studio（Docker :80）
const child = spawn("npm", ["run", "dev"], { stdio: "inherit", shell: true });

function shutdown(signal) {
  if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
