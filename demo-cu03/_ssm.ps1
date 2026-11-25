# Funciones comunes de la demo. Antes de presentar, dejar cargado el id:
#   $env:MAIL_INSTANCE_ID = terraform -chdir=terraform output -raw mail_instance_id
function Get-MailInstance {
  if ($env:MAIL_INSTANCE_ID) { return $env:MAIL_INSTANCE_ID }
  $tf = Join-Path $PSScriptRoot "..\terraform"
  return (terraform "-chdir=$tf" output -raw mail_instance_id)
}

# Corre un script bash como root en el mail server y muestra el resultado.
function Invoke-Mail([string]$Script) {
  $instance = Get-MailInstance
  $file = Join-Path $env:TEMP "demo-cu03-ssm.json"
  $body = @{ commands = @(($Script -replace "`r", "")) } | ConvertTo-Json -Depth 3
  [IO.File]::WriteAllText($file, $body, (New-Object Text.UTF8Encoding($false)))
  $id = aws ssm send-command --instance-ids $instance --document-name AWS-RunShellScript --parameters "file://$file" --query Command.CommandId --output text
  Remove-Item $file
  if (-not $id) { throw "No se pudo enviar el comando por SSM" }
  do {
    Start-Sleep -Seconds 1
    $status = aws ssm get-command-invocation --command-id $id --instance-id $instance --query Status --output text 2>$null
  } while ($status -in @($null, "", "Pending", "InProgress", "Delayed"))
  aws ssm get-command-invocation --command-id $id --instance-id $instance --query "[Status,StandardOutputContent,StandardErrorContent]" --output text
}
