$ErrorActionPreference = 'Stop'

$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object -First 1

if (-not $route) {
  exit 1
}

$address = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
  Where-Object {
    $_.AddressState -eq 'Preferred' -and
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*'
  } |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $address) {
  exit 1
}

Write-Output $address
