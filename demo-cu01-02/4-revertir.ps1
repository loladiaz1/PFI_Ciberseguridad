# Deshace el bloqueo y el aislamiento: las reglas de iptables no sobreviven a un
# reinicio. Espera a que el puerto 22 vuelva a responder.
. "$PSScriptRoot\_victima.ps1"

aws ec2 reboot-instances --instance-ids $VictimId
Write-Host "Reiniciando la victima..." -ForegroundColor Yellow
Start-Sleep -Seconds 30
$ip = Get-VictimIp
do {
  Start-Sleep -Seconds 5
  $c = New-Object Net.Sockets.TcpClient
  $ok = $c.ConnectAsync($ip, 22).Wait(3000) -and $c.Connected
  $c.Close()
} until ($ok)
Write-Host "Victima lista: puerto 22 abierto." -ForegroundColor Green
