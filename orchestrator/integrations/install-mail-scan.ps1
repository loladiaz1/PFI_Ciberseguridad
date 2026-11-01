# Instala mail-scan.py y su servicio en el mail server por SSM.
#   powershell -File orchestrator/integrations/install-mail-scan.ps1 -InstanceId <mail_instance_id>
param([Parameter(Mandatory = $true)][string]$InstanceId)
$ErrorActionPreference = "Stop"

function Base64Of($path) { [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $path))) }

$script = (Get-Content -Raw (Join-Path $PSScriptRoot "install-mail-scan.sh")) -replace "`r", ""
# El shebang tiene que ser la primera linea: sin el, SSM lo corre con sh (dash),
# que no conoce "set -o pipefail".
$commands = @(
  "#!/bin/bash",
  "export MAIL_SCAN_PY=$(Base64Of 'mail-scan.py')",
  "export MAIL_SCAN_UNIT=$(Base64Of 'mail-scan.service')",
  $script
)
$file = Join-Path $env:TEMP "mail-scan-ssm.json"
[IO.File]::WriteAllText($file, (@{ commands = $commands } | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))

$id = aws ssm send-command --instance-ids $InstanceId --document-name AWS-RunShellScript --parameters "file://$file" --query Command.CommandId --output text
aws ssm wait command-executed --command-id $id --instance-id $InstanceId
aws ssm get-command-invocation --command-id $id --instance-id $InstanceId --query "[Status,StandardOutputContent,StandardErrorContent]" --output text
Remove-Item $file
