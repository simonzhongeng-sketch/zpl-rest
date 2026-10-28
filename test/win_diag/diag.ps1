# Network diagnostic for the PCs that cannot find the printers.
# Read-only: prints addresses, gateway, Wi-Fi SSID, and for each target IP a
# ping plus a TCP 9100 connect test. Writes diag-<hostname>.txt next to itself.
#
# Usage: diag.bat            (targets below)
#        diag.bat 192.168.8.43 192.168.8.45

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
# with -File, positional arguments land in $args (a named [string[]] would
# only bind the first one)
$Targets = $args
if (-not $Targets -or $Targets.Count -eq 0) {
  $Targets = @('192.168.8.43', '192.168.8.45', '192.168.8.19')
}

$out = New-Object System.Collections.Generic.List[string]
function W($s) { $out.Add($s); Write-Host $s }

W "=== zpl-rest network diagnostic ==="
W ("time      : " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ("computer  : " + $env:COMPUTERNAME + " / " + $env:USERNAME)
W ("os        : " + (Get-CimInstance Win32_OperatingSystem).Caption)
W ("psversion : " + $PSVersionTable.PSVersion.ToString())
W ""

W "--- IPv4 addresses (name | ip | prefix | gateway) ---"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | ForEach-Object {
  $gw = ''
  $cfg = Get-NetIPConfiguration -InterfaceIndex $_.InterfaceIndex
  if ($cfg.IPv4DefaultGateway) { $gw = $cfg.IPv4DefaultGateway.NextHop }
  W ($_.InterfaceAlias + " | " + $_.IPAddress + " | /" + $_.PrefixLength + " | " + $gw)
}
W ""

W "--- routing table (0.0.0.0/0) ---"
Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | ForEach-Object {
  W ("ifIndex " + $_.InterfaceIndex + " -> gateway " + $_.NextHop + " metric " + $_.RouteMetric)
}
W ""

W "--- wireless ---"
$wl = netsh wlan show interfaces
if ($wl) { $wl | Where-Object { $_ -match 'SSID|Signal|State|状态|信号' } | ForEach-Object { W $_.Trim() } } else { W "(no wireless interface / not reported)" }
W ""

foreach ($t in $Targets) {
  W ("--- target " + $t + " ---")
  $p = ping -n 1 -w 1500 $t
  $pingOk = $false
  if ($p -match 'TTL=') { $pingOk = $true }
  W ("ping      : " + $(if ($pingOk) { "OK" } else { "FAIL" }))
  $tnc = Test-NetConnection -ComputerName $t -Port 9100 -WarningAction SilentlyContinue
  W ("tcp 9100  : " + $(if ($tnc.TcpTestSucceeded) { "OPEN" } else { "CLOSED/BLOCKED" }))
  $tnc80 = Test-NetConnection -ComputerName $t -Port 80 -WarningAction SilentlyContinue
  W ("tcp 80    : " + $(if ($tnc80.TcpTestSucceeded) { "OPEN" } else { "CLOSED/BLOCKED" }))
  # layer-2 presence: a MAC in the neighbour table means the same broadcast
  # domain; no entry means the traffic had to be routed (another subnet)
  $nb = Get-NetNeighbor -IPAddress $t | Where-Object { $_.LinkLayerAddress -and $_.State -ne 'Unreachable' } | Select-Object -First 1
  if ($nb) { W ("neighbour : " + $nb.LinkLayerAddress + " on " + $nb.InterfaceAlias + " (same L2 segment)") } else { W "neighbour : none (routed / another subnet, or nothing answered ARP)" }
  W ""
}

W "--- interpretation ---"
W "ping OK + tcp 9100 OPEN   : this PC can print; a scan failure would be an app problem"
W "ping OK + tcp 9100 CLOSED : printer reachable but Raw/9100 disabled or blocked by a firewall"
W "ping FAIL                 : different subnet / VLAN, or Wi-Fi client isolation (AP isolation)"
W ""
W "Send this file back for analysis."

$file = Join-Path $PSScriptRoot ("diag-" + $env:COMPUTERNAME + ".txt")
$out | Set-Content -Path $file -Encoding UTF8
Write-Host ""
Write-Host ("saved: " + $file)
