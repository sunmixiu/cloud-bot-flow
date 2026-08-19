import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // 平台适配层：镜像构建 / 仓库 / Pipeline / MinIO 产物
      "/api/cube/platform": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cube/, ""),
      },
      // 本地扩展能力（代码库、仿真、机器人 CRUD）
      "/api/cube/code_repository": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cube/, ""),
      },
      "/api/cube/simulation_algorithm": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cube/, ""),
      },
      "/api/cube/robot_modelview": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cube/, ""),
      },
      "/api/cube/simulation": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cube/, ""),
      },
      // 真实 Cube Studio：任务/算法/数据集/登录等
      "/api/cube": {
        target: "http://127.0.0.1",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cube/, ""),
      },
    },
  },
  plugins: [react()],
  build: {
    // Three.js and the AI design/ECharts workbench are isolated on-demand chunks.
    chunkSizeWarningLimit: 1300,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
}));
