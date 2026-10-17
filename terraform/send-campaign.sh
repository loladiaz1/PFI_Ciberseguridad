#!/bin/bash
# Demo de la busqueda de correos similares (CU-03). Corre EN el mail server,
# como root, por SSM (no esta en el user_data para no reemplazar la instancia
# al cambiarlo):
#   aws ssm send-command --instance-ids <mail_instance_id> --document-name AWS-RunShellScript \
#     --parameters commands="$(cat terraform/send-campaign.sh)"
#
# Llegan dos variantes de la campana, con otro asunto y otro remitente pero la
# misma infraestructura (el adjunto EICAR; el dominio del enlace y el
# Responder a), y un correo legitimo que no tiene nada en comun. Despues corre
# send-phish: llega el original y alice lo reporta. La busqueda automatica del
# incidente tiene que encontrar las dos variantes y no el legitimo.
set -euo pipefail
DOMAIN=lab.micro-soar.internal
ID="$(date +%s)-$RANDOM"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > "$TMP/comprobante.exe"

# Variante 1: mismo adjunto, otro asunto y remitente (solo a bob).
swaks --server 127.0.0.1 --silent 2 \
  --from "tesoreria@pagos-proveedores.test" --to "bob@$DOMAIN" \
  --header "Message-Id: <comprobante-$ID@pagos-proveedores.test>" \
  --header "From: Tesoreria <tesoreria@pagos-proveedores.test>" \
  --header "Subject: Comprobante de transferencia" \
  --body "Adjuntamos el comprobante de la transferencia realizada." \
  --attach-type application/octet-stream --attach-name comprobante.exe --attach @"$TMP/comprobante.exe"

# Variante 2: mismo dominio de enlace (otra ruta) y mismo Responder a.
swaks --server 127.0.0.1 --silent 2 \
  --from "avisos@cobranzas-online.test" --to "alice@$DOMAIN,bob@$DOMAIN" \
  --header "Message-Id: <aviso-$ID@cobranzas-online.test>" \
  --header "From: Avisos <avisos@cobranzas-online.test>" \
  --header "Reply-To: cobranzas@pagos-urgentes.test" \
  --header "Subject: Ultimo aviso antes de la suspension" \
  --body "Evite la suspension del servicio: http://malware.testing.google.test/testing/malware/pago"

# Legitimo: nada en comun con la campana (no tiene que aparecer).
swaks --server 127.0.0.1 --silent 2 \
  --from "rrhh@$DOMAIN" --to "alice@$DOMAIN" \
  --header "Message-Id: <novedades-$ID@$DOMAIN>" \
  --header "Subject: Novedades de octubre" \
  --body "Les recordamos que el viernes es feriado."

sleep 2
send-phish
echo "Variantes enviadas: <comprobante-$ID@pagos-proveedores.test>, <aviso-$ID@cobranzas-online.test>; legitimo: <novedades-$ID@$DOMAIN>"
