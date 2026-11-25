# Deja el laboratorio listo para otra corrida. BORRA todo el correo de INBOX y
# Quarantine de alice y bob. Antes, cerrar el caso en la app: un incidente
# abierto absorbe la campana siguiente.
. "$PSScriptRoot\_ssm.ps1"

Invoke-Mail @'
#!/bin/bash
set -euo pipefail
DOMAIN=lab.micro-soar.internal
for user in alice bob; do
  doveadm expunge -u "$user@$DOMAIN" mailbox INBOX all
  doveadm expunge -u "$user@$DOMAIN" mailbox Quarantine all
done
rm -f /run/demo-cu03-msgid
systemctl restart mail-scan
systemctl is-active mail-scan
'@
