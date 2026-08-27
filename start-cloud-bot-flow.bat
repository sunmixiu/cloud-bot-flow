@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Cloud Bot Flow 一键启动

rem 始终以本 BAT 所在目录作为项目目录，移动整个仓库后仍可使用。
set "PROJECT_DIR=%~dp0"
set "DOCKER_DESKTOP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set "APP_URL=http://127.0.0.1:3001"
set "OUTPUT_DIR=%PROJECT_DIR%output"
set "EDGE_TOKEN_FILE=%OUTPUT_DIR%\edge-agent-bootstrap-token.txt"
set "HOST=0.0.0.0"
set "REGISTRY_PROXY_HOST=0.0.0.0"
set "REGISTRY_PROXY_PORT=5002"
set "NO_BROWSER=0"
if /I "%~1"=="--no-browser" set "NO_BROWSER=1"

cd /d "%PROJECT_DIR%"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if not exist "%EDGE_TOKEN_FILE%" (
  powershell -NoProfile -Command "$token=([guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')); Set-Content -LiteralPath '%EDGE_TOKEN_FILE%' -Value $token -Encoding ASCII"
  if errorlevel 1 goto :failed
)
for /f "usebackq delims=" %%T in ("%EDGE_TOKEN_FILE%") do set "EDGE_AGENT_BOOTSTRAP_TOKEN=%%T"
if not defined EDGE_AGENT_BOOTSTRAP_TOKEN (
  echo [错误] Edge Agent 登记密钥为空：%EDGE_TOKEN_FILE%
  goto :failed
)

echo ============================================================
echo   机器人云边协同调度平台 - 一键启动
echo ============================================================
echo.

call :require_command node.exe Node.js
if errorlevel 1 goto :failed
call :require_command npm.cmd npm
if errorlevel 1 goto :failed
call :require_command docker.exe Docker
if errorlevel 1 goto :failed
call :require_command kubectl.exe kubectl
if errorlevel 1 goto :failed

echo [1/8] 检查 Docker Desktop...
docker info >nul 2>&1
if errorlevel 1 (
  if not exist "%DOCKER_DESKTOP%" (
    echo [错误] 找不到 Docker Desktop：%DOCKER_DESKTOP%
    echo 请先安装 Docker Desktop，然后重新运行本文件。
    goto :failed
  )
  echo Docker 尚未启动，正在打开 Docker Desktop...
  start "" "%DOCKER_DESKTOP%"
  call :wait_for_docker 180
  if errorlevel 1 goto :failed
) else (
  echo Docker 已运行。
)

echo [2/8] 启动宿主机 MinIO...
docker compose -f docker-compose.minio.yml up -d
if errorlevel 1 (
  echo [错误] MinIO 启动失败。
  goto :failed
)

echo [3/8] 恢复本地 Registry 和 kind 集群...
call :start_existing_container cube-studio-registry "本地 OCI Registry"
if errorlevel 1 goto :missing_cluster
call :start_existing_container cube-studio-control-plane "kind / Cube Studio 控制节点"
if errorlevel 1 goto :missing_cluster
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\get-lan-ip.ps1"`) do set "PLATFORM_LAN_IP=%%I"
if not defined PLATFORM_LAN_IP (
  echo [错误] 无法识别局域网 IPv4 地址，不能为 WSL / 机器人发布镜像仓库。
  goto :failed
)
set "EDGE_REGISTRY_PUBLIC_ENDPOINT=%PLATFORM_LAN_IP%:%REGISTRY_PROXY_PORT%"
call :check_http "http://127.0.0.1:%REGISTRY_PROXY_PORT%/v2/"
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath 'node.exe' -ArgumentList 'backend/registry-proxy.mjs' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%OUTPUT_DIR%\registry-proxy.log' -RedirectStandardError '%OUTPUT_DIR%\registry-proxy-error.log' -PassThru; Set-Content -Encoding ASCII '%OUTPUT_DIR%\registry-proxy.pid' $p.Id"
  if errorlevel 1 (
    echo [错误] 无法启动边缘 Registry 代理。
    goto :failed
  )
  call :wait_for_http "http://127.0.0.1:%REGISTRY_PROXY_PORT%/v2/" 30
  if errorlevel 1 (
    echo [错误] 边缘 Registry 代理未就绪，请查看 output\registry-proxy-error.log。
    goto :failed
  )
)
echo 边缘镜像仓库已发布：%EDGE_REGISTRY_PUBLIC_ENDPOINT%

echo [4/8] 切换并等待 Kubernetes 集群...
kubectl config get-contexts kind-cube-studio >nul 2>&1
if errorlevel 1 (
  echo [错误] kubeconfig 中不存在 kind-cube-studio context。
  goto :missing_cluster
)
kubectl config use-context kind-cube-studio >nul
if errorlevel 1 goto :failed

kubectl wait --for=condition=Ready node --all --timeout=120s >nul
if errorlevel 1 (
  echo [错误] Kubernetes 节点在 120 秒内没有 Ready。
  goto :failed
)

kubectl -n kubeflow rollout status deployment/workflow-controller --timeout=120s >nul
if errorlevel 1 (
  echo [错误] Argo Workflow Controller 未就绪。
  goto :failed
)
kubectl -n kubeflow rollout status deployment/minio --timeout=120s >nul
if errorlevel 1 (
  echo [错误] 集群内 MinIO 未就绪。
  goto :failed
)
echo Kubernetes、Argo 和集群内 MinIO 已就绪。

echo [5/8] 检查前端依赖...
if not exist "node_modules\.package-lock.json" (
  echo 首次运行或依赖缺失，正在执行 npm install...
  call npm install
  if errorlevel 1 goto :failed
) else (
  echo node_modules 已存在，跳过依赖安装。
)

echo [6/8] 构建前端...
call npm run build
if errorlevel 1 (
  echo [错误] 前端构建失败。
  goto :failed
)

echo [7/8] 启动平台后端...
call :check_http "%APP_URL%/health"
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath 'node.exe' -ArgumentList 'backend/server.mjs' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%OUTPUT_DIR%\backend.log' -RedirectStandardError '%OUTPUT_DIR%\backend-error.log' -PassThru; Set-Content -Encoding ASCII '%OUTPUT_DIR%\backend.pid' $p.Id"
  if errorlevel 1 (
    echo [错误] 无法创建平台后端进程。
    goto :failed
  )
  call :wait_for_http "%APP_URL%/health" 60
  if errorlevel 1 (
    echo [错误] 后端在 60 秒内没有启动，请查看 output\backend-error.log。
    goto :failed
  )
) else (
  echo 端口 3001 上的平台后端已经运行，不重复启动。
)

echo [8/8] 检查完整运行依赖...
call :check_http "%APP_URL%/health/ready"
if errorlevel 1 (
  echo [错误] 页面服务已启动，但 MinIO 或 Kubernetes 尚未通过 readiness 检查。
  echo 请访问 %APP_URL%/health/ready 查看具体原因。
  goto :failed
)

echo [WSL] 启动并保持 ROS 2 Edge Agent 在线...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\ensure-wsl-edge-agent.ps1"
if errorlevel 1 (
  echo [错误] WSL2 Edge Agent 未能启动，请查看 output\wsl-edge-agent-keepalive-error.log。
  goto :failed
)

echo.
echo ============================================================
echo   启动成功
echo   平台地址：%APP_URL%
echo   管理员：admin / admin123
echo   Edge Agent 登记密钥：%EDGE_TOKEN_FILE%
echo ============================================================
echo.

if "%NO_BROWSER%"=="0" start "" "%APP_URL%"
echo 可以关闭本窗口；平台后端已在后台运行。
echo 后端日志：output\backend.log 和 output\backend-error.log
pause
exit /b 0

:require_command
where %~1 >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 %~2（%~1），请先安装并加入 PATH。
  exit /b 1
)
exit /b 0

:wait_for_docker
set /a "WAITED=0"
:wait_for_docker_loop
docker info >nul 2>&1
if not errorlevel 1 (
  echo Docker Desktop 已就绪。
  exit /b 0
)
if !WAITED! GEQ %~1 (
  echo [错误] Docker Desktop 在 %~1 秒内没有就绪。
  exit /b 1
)
set /a "WAITED+=3"
echo 等待 Docker Desktop... !WAITED!/%~1 秒
ping 127.0.0.1 -n 4 >nul
goto :wait_for_docker_loop

:start_existing_container
docker inspect %~1 >nul 2>&1
if errorlevel 1 (
  echo [错误] 缺少容器 %~1（%~2）。
  exit /b 1
)
for /f "usebackq delims=" %%S in (`docker inspect -f "{{.State.Running}}" %~1`) do set "IS_RUNNING=%%S"
if /I not "!IS_RUNNING!"=="true" (
  docker start %~1 >nul
  if errorlevel 1 (
    echo [错误] 无法启动 %~1（%~2）。
    exit /b 1
  )
)
echo %~2 已运行。
exit /b 0

:check_http
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 '%~1'; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 300){exit 0}; exit 1 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:wait_for_http
set /a "HTTP_WAITED=0"
:wait_for_http_loop
call :check_http "%~1"
if not errorlevel 1 exit /b 0
if !HTTP_WAITED! GEQ %~2 exit /b 1
set /a "HTTP_WAITED+=2"
ping 127.0.0.1 -n 3 >nul
goto :wait_for_http_loop

:missing_cluster
echo.
echo 本脚本可以在电脑重启后恢复已有容器，但不会在容器被删除后重建整套集群。
echo 如容器已经被删除，请按以下文档重新初始化：
echo   infrastructure\cube-studio-local\README.md
goto :failed

:failed
echo.
echo ============================================================
echo   启动没有完成，请根据上方第一条错误处理后重试。
echo ============================================================
pause
exit /b 1
