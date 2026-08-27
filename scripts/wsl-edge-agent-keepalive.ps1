param(
  [string]$Distro = 'Ubuntu-22.04'
)

$ErrorActionPreference = 'Stop'

& wsl.exe -d $Distro -u root -- bash -lc `
  'set -e; systemctl start docker; systemctl restart cloud-bot-edge-agent; exec -a cloud-bot-flow-wsl-keepalive sleep infinity'

exit $LASTEXITCODE
