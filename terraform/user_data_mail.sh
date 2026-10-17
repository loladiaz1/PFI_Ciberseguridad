#!/bin/bash
# Mail server de laboratorio para CU-03 (ver mail.tf). Template de Terraform:
# lo que va entre llaves con signo pesos lo reemplaza templatefile(); las
# variables de bash van sin llaves.
set -euxo pipefail
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/99-ubuntu-nopasswd
chmod 440 /etc/sudoers.d/99-ubuntu-nopasswd
hostnamectl set-hostname micro-soar-mail

DOMAIN='${mail_domain}'
MASTER_PASSWORD='${mail_master_password}'
DEMO_PASSWORD='${mail_demo_password}'
export DEBIAN_FRONTEND=noninteractive

# --- Postfix: entrega local, solo loopback (el puerto 25 no se abre) -------
debconf-set-selections <<< "postfix postfix/mailname string mail.$DOMAIN"
debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Local only'"
apt-get update
# ssl-cert: certificado autofirmado (snakeoil) que usa Dovecot para IMAPS.
apt-get install -y ssl-cert postfix dovecot-imapd dovecot-lmtpd swaks

postconf -e "myhostname = mail.$DOMAIN" \
  "inet_interfaces = loopback-only" \
  "mydestination = localhost" \
  "virtual_mailbox_domains = $DOMAIN" \
  "virtual_transport = lmtp:unix:private/dovecot-lmtp"

# --- Dovecot: IMAPS + LMTP, usuarios virtuales en /var/vmail ---------------
useradd --system --uid 5000 --user-group --home-dir /var/vmail --create-home --shell /usr/sbin/nologin vmail
# Sin autenticacion contra los usuarios del sistema (PAM): solo los buzones
# del laboratorio y el usuario master.
sed -i 's/^!include auth-system.conf.ext/#!include auth-system.conf.ext/' /etc/dovecot/conf.d/10-auth.conf

cat > /etc/dovecot/local.conf <<'CONF'
protocols = imap lmtp
listen = *
mail_location = maildir:/var/vmail/%d/%n/Maildir
first_valid_uid = 5000
last_valid_uid = 5000
ssl = required
disable_plaintext_auth = yes
auth_mechanisms = plain

# Usuario master: "alice@dominio*soar" entra al buzon de alice con la clave
# de soar. Solo desde la IP del orchestrator (allow_nets en master-users).
auth_master_user_separator = *
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT /etc/dovecot/master-users
  master = yes
  result_success = continue
}
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u /etc/dovecot/users
}
userdb {
  driver = static
  args = uid=vmail gid=vmail home=/var/vmail/%d/%n
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}

# Carpetas que usa el orchestrator (src/mailProvider.js).
namespace inbox {
  mailbox Quarantine {
    auto = subscribe
  }
  mailbox Processed {
    auto = subscribe
  }
  mailbox Invalid {
    auto = subscribe
  }
}
CONF

MASTER_HASH=$(doveadm pw -s SHA512-CRYPT -p "$MASTER_PASSWORD")
echo "soar:$MASTER_HASH::::::allow_nets=${orchestrator_ip}/32" > /etc/dovecot/master-users

DEMO_HASH=$(doveadm pw -s SHA512-CRYPT -p "$DEMO_PASSWORD")
: > /etc/dovecot/users
for user in alice bob phishing; do
  echo "$user@$DOMAIN:$DEMO_HASH" >> /etc/dovecot/users
done
chown root:dovecot /etc/dovecot/master-users /etc/dovecot/users
chmod 640 /etc/dovecot/master-users /etc/dovecot/users

systemctl restart dovecot postfix

# --- Demo: "send-phish" (por SSM o SSH, como root) -------------------------
# Llega una campana de phishing a alice y bob (link + adjunto EICAR), y alice
# la reporta reenviando el ORIGINAL como adjunto (.eml) a phishing@, igual que
# el boton "Report phishing" de Outlook / Gmail: asi se conserva el
# Message-ID para encontrarlo en los buzones.
cat > /usr/local/bin/send-phish <<'SCRIPT'
#!/bin/bash
set -euo pipefail
DOMAIN='${mail_domain}'
ID="$(date +%s)-$RANDOM"
MSGID="<factura-$ID@proveedor-pagos.test>"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Archivo de prueba EICAR (inofensivo, todos los antivirus lo detectan).
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > "$TMP/factura.exe"

swaks --server 127.0.0.1 --silent 2 \
  --from "facturacion@proveedor-pagos.test" \
  --to "alice@$DOMAIN,bob@$DOMAIN" \
  --header "Message-Id: $MSGID" \
  --header "From: Facturacion <facturacion@proveedor-pagos.test>" \
  --header "Reply-To: cobranzas@pagos-urgentes.test" \
  --header "Subject: Factura vencida - accion requerida" \
  --body "Su factura esta vencida. Regularice el pago en http://malware.testing.google.test/testing/malware/ o descargue el adjunto." \
  --attach-type application/octet-stream --attach-name factura.exe --attach @"$TMP/factura.exe"

ALICE="/var/vmail/$DOMAIN/alice/Maildir"
FILE=""
for _ in $(seq 1 20); do
  FILE=$(grep -rlF "$MSGID" "$ALICE/new" "$ALICE/cur" 2>/dev/null | head -n1 || true)
  [ -n "$FILE" ] && break
  sleep 0.5
done
[ -n "$FILE" ] || { echo "El correo no llego al buzon de alice" >&2; exit 1; }

swaks --server 127.0.0.1 --silent 2 \
  --from "alice@$DOMAIN" --to "phishing@$DOMAIN" \
  --header "Subject: Posible phishing" \
  --body "Me llego esto y parece falso." \
  --attach-type message/rfc822 --attach-name original.eml --attach @"$FILE"

echo "Campana enviada ($MSGID) y reportada por alice"
SCRIPT
chmod 755 /usr/local/bin/send-phish

# --- Agente Wazuh (hoy inventario; a futuro, los logs de Rspamd) -----------
curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import
chmod 644 /usr/share/keyrings/wazuh.gpg
echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | tee -a /etc/apt/sources.list.d/wazuh.list
apt-get update
WAZUH_MANAGER='${wazuh_manager_ip}' WAZUH_AGENT_NAME='micro-soar-mail' apt-get install -y wazuh-agent=${wazuh_agent_version}-1
systemctl daemon-reload
systemctl enable wazuh-agent
systemctl start wazuh-agent
