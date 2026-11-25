# Prueba LOCAL del recomendador, sin Wazuh: manda al webhook del orchestrator
# la misma alerta que generaria Wazuh. Solo para la laptop: en AWS se usan
# 1-job-monitoreo.ps1 y demo-cu01-02/1-fuerza-bruta.ps1 (alertas reales).
#
#   .\simular-local.ps1 -Tipo job                  # una alerta del job de monitoreo (127.0.0.1)
#   .\simular-local.ps1 -Tipo ataque               # una alerta de fuerza bruta (IP del mock)
#   .\simular-local.ps1 -Tipo malware              # una alerta de VirusTotal (CU-02)
#   .\simular-local.ps1 -Tipo job -Historial 3     # crea y cierra 3 como benigno (atajo)
#
# -Historial cierra por la API como el usuario de $env:FORTIA_USER /
# $env:FORTIA_PASSWORD (si no estan, los pide). job -> benigno positivo,
# ataque y malware -> verdadero positivo.
param(
  [ValidateSet("job", "ataque", "malware")] [string]$Tipo = "job",
  [int]$Historial = 0,
  [string]$Api = "http://localhost:8000"
)
$ErrorActionPreference = "Stop"
$mocks = Join-Path $PSScriptRoot "..\orchestrator\mocks"

function New-Alert {
  $file = if ($Tipo -eq "malware") { "wazuh_malware_detected.json" } else { "wazuh_ssh_bruteforce.json" }
  $a = Get-Content (Join-Path $mocks $file) -Raw | ConvertFrom-Json
  # Agente 001 = la victima del inventario (criticidad baja), como en AWS.
  $a.agent.id = "001"
  $a.agent.name = "victima-laboratorio"
  $a.timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff") + "+0000"
  if ($Tipo -eq "job") { $a.data.srcip = "127.0.0.1" }
  return ($a | ConvertTo-Json -Depth 20)
}

function Send-Alert {
  $r = Invoke-RestMethod -Method Post -Uri "$Api/api/v1/webhook/wazuh" -ContentType "application/json" -Body (New-Alert)
  $what = if ($r.grouped) { "sumada al incidente" } else { "incidente" }
  Write-Host ("{0:HH:mm:ss}  {1}: {2} #{3} ({4})" -f (Get-Date), $Tipo, $what, $r.id, $(if ($r.srcIp) { $r.srcIp } else { $r.hostname })) -ForegroundColor Green
  return $r
}

if ($Historial -le 0) {
  Send-Alert | Out-Null
  exit 0
}

$user = if ($env:FORTIA_USER) { $env:FORTIA_USER } else { Read-Host "Usuario (admin o analista)" }
$pass = if ($env:FORTIA_PASSWORD) { $env:FORTIA_PASSWORD } else {
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host "Contraseña" -AsSecureString)))
}
$login = Invoke-RestMethod -Method Post -Uri "$Api/api/v1/auth/login" -ContentType "application/json" -Body (@{ username = $user; password = $pass } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
$closure = if ($Tipo -eq "job") {
  @{ verdict = "benign_positive"; note = "Job de monitoreo con credenciales vencidas"; tags = @("authorized_activity") }
} else {
  @{ verdict = "true_positive"; tags = @() }
}

for ($i = 1; $i -le $Historial; $i++) {
  $incident = Send-Alert
  Start-Sleep -Seconds 1  # la automatizacion corre en segundo plano
  try {
    Invoke-RestMethod -Method Post -Uri "$Api/api/v1/incidents/$($incident.id)/close" -Headers $headers -ContentType "application/json" -Body ($closure | ConvertTo-Json) | Out-Null
    Write-Host "           cerrado como $($closure.verdict)"
  } catch {
    Write-Host "           no se cerro (ya estaba cerrado?): $($_.ErrorDetails.Message)" -ForegroundColor Yellow
  }
}
