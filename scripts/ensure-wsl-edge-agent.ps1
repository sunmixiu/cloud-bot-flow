param(
  [string]$Distro = 'Ubuntu-22.04'
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectDir 'output'
$pidPath = Join-Path $outputDir 'wsl-edge-agent-keepalive.pid'
$stdoutPath = Join-Path $outputDir 'wsl-edge-agent-keepalive.log'
$stderrPath = Join-Path $outputDir 'wsl-edge-agent-keepalive-error.log'
$keeperScript = Join-Path $PSScriptRoot 'wsl-edge-agent-keepalive.ps1'

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$installed = @(& wsl.exe --list --quiet) | ForEach-Object { $_.Trim([char]0).Trim() }
if ($installed -notcontains $Distro) {
  throw "WSL distribution is not installed: $Distro"
}

$keeper = $null
if (Test-Path -LiteralPath $pidPath) {
  $savedPid = (Get-Content -Raw -LiteralPath $pidPath).Trim()
  if ($savedPid -match '^\d+$') {
    $keeper = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
  }
}

if (-not $keeper) {
  $keeper = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $keeperScript, '-Distro', $Distro) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  Set-Content -LiteralPath $pidPath -Value $keeper.Id -Encoding ASCII
}

$deadline = (Get-Date).AddSeconds(30)
do {
  & wsl.exe -d $Distro -u root -- systemctl is-active --quiet docker
  $dockerReady = $LASTEXITCODE -eq 0
  & wsl.exe -d $Distro -u root -- systemctl is-active --quiet cloud-bot-edge-agent
  $agentReady = $LASTEXITCODE -eq 0
  if ($dockerReady -and $agentReady) {
    Write-Output "WSL2 Docker and Edge Agent are active (keeper PID $($keeper.Id))."
    exit 0
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

throw "WSL2 Docker or cloud-bot-edge-agent did not become active within 30 seconds. See $stderrPath"
