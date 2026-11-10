# Funciones comunes para grabar CU-01 y CU-02 contra la victima.
# La victima no tiene SSM: se entra por SSH con EC2 Instance Connect y la clave
# ~/.ssh/eic_temp (vale 60 s desde que se envia). El SSH solo acepta la IP
# cargada en my_ip de Terraform.
$VictimId = "i-0b312b4756af564d0"
$VictimZone = "us-east-1d"
$Key = "$env:USERPROFILE\.ssh\eic_temp"
$env:AWS_PAGER = ""

function Get-VictimIp {
  aws ec2 describe-instances --instance-ids $VictimId --query "Reservations[0].Instances[0].PublicIpAddress" --output text
}

# Corre un comando en la victima como ubuntu.
function Invoke-Victim([string]$Command) {
  $ip = Get-VictimIp
  aws ec2-instance-connect send-ssh-public-key --instance-id $VictimId --instance-os-user ubuntu `
    --availability-zone $VictimZone --ssh-public-key "file://$Key.pub" --query Success --output text | Out-Null
  ssh -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=8 "ubuntu@$ip" $Command
}
