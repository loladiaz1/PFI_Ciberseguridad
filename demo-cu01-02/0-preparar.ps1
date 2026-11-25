# Prende wazuh, orquestador y victima, y espera a que la victima responda por
# SSH. El servidor de correo no hace falta para CU-01 ni CU-02.
. "$PSScriptRoot\_victima.ps1"

$ids = "i-0c34dd0e97d3cdb7e", "i-0d00bff5cc0163947", $VictimId
aws ec2 start-instances --instance-ids $ids --query "StartingInstances[].[InstanceId,CurrentState.Name]" --output text
Write-Host "Esperando que las instancias pasen los chequeos (unos minutos)..." -ForegroundColor Yellow
aws ec2 wait instance-status-ok --instance-ids $ids
aws ec2 describe-instances --instance-ids $ids --query "Reservations[].Instances[].[Tags[?Key=='Name']|[0].Value,State.Name]" --output text

$ip = Get-VictimIp
$c = New-Object Net.Sockets.TcpClient
$ok = $c.ConnectAsync($ip, 22).Wait(3000) -and $c.Connected
$c.Close()
if ($ok) { Write-Host "Victima $ip lista: puerto 22 abierto." -ForegroundColor Green }
else { Write-Host "La victima no responde en el 22: revisa que estes en la red de tu casa (my_ip)." -ForegroundColor Red }
Write-Host "Dale 2 o 3 minutos mas a Wazuh antes de atacar." -ForegroundColor Yellow
