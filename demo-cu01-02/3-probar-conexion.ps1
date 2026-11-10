# Prueba visible de la contencion: intenta abrir el puerto 22 de la victima
# cada 2 segundos. Antes de aislar o bloquear dice ABIERTO; despues, CERRADO.
. "$PSScriptRoot\_victima.ps1"

$ip = Get-VictimIp
Write-Host "Probando la conexion con $ip..." -ForegroundColor Yellow
while ($true) {
  $c = New-Object Net.Sockets.TcpClient
  $ok = $c.ConnectAsync($ip, 22).Wait(2000) -and $c.Connected
  $c.Close()
  if ($ok) { Write-Host ("{0:HH:mm:ss}  puerto 22: ABIERTO" -f (Get-Date)) -ForegroundColor Green }
  else { Write-Host ("{0:HH:mm:ss}  puerto 22: CERRADO" -f (Get-Date)) -ForegroundColor Red }
  Start-Sleep -Seconds 2
}
