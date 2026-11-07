#!/bin/bash
# Instala la regla de correo en el mail server (como root, por SSM; ver
# install-mail-scan.ps1). No esta en el user_data para no reemplazar la
# instancia. Espera MAIL_SCAN_PY y MAIL_SCAN_UNIT en base64. Idempotente.
set -euo pipefail

printf '%s' "$MAIL_SCAN_PY" | base64 -d | tr -d '\r' > /usr/local/bin/mail-scan.py
chmod 755 /usr/local/bin/mail-scan.py
printf '%s' "$MAIL_SCAN_UNIT" | base64 -d | tr -d '\r' > /etc/systemd/system/mail-scan.service

touch /var/log/mail-scan.json
chmod 640 /var/log/mail-scan.json

CONF=/var/ossec/etc/ossec.conf
if ! grep -q '/var/log/mail-scan.json' "$CONF"; then
  cp -p "$CONF" "$CONF.bak-$(date +%F)-mail-scan"
  sed -i '0,/<\/ossec_config>/s##  <localfile>\n    <log_format>json</log_format>\n    <location>/var/log/mail-scan.json</location>\n  </localfile>\n</ossec_config>#' "$CONF"
  systemctl restart wazuh-agent
fi

systemctl daemon-reload
systemctl enable mail-scan
systemctl restart mail-scan
systemctl is-active mail-scan
systemctl is-active wazuh-agent
