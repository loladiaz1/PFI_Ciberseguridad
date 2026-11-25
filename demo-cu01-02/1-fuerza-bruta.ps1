# CU-01: fuerza bruta SSH contra la victima, desde esta notebook. Cada intento
# usa un usuario inexistente y muestra la respuesta del servidor. Cuando la app
# bloquea la IP, la respuesta pasa de "Permission denied" a "Connection timed out".
. "$PSScriptRoot\_victima.ps1"

$ip = Get-VictimIp
Write-Host "Atacando $ip por SSH..." -ForegroundColor Yellow
for ($i = 1; $i -le 60; $i++) {
  $out = ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=5 `
    "admin$i@$ip" exit 2>&1 | Select-Object -Last 1
  Write-Host ("{0:HH:mm:ss}  intento {1,2}: {2}" -f (Get-Date), $i, $out)
  Start-Sleep -Milliseconds 700
}
