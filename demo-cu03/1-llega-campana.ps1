# Llega la campana (original y 2 variantes) y un correo legitimo, sin reporte.
# No usa send-phish ni send-campaign.sh: esos reportan solos.
# Bob queda como abierto solo en el original. Requiere el adjunto de prueba EICAR.
. "$PSScriptRoot\_ssm.ps1"

Invoke-Mail @'
#!/bin/bash
set -euo pipefail
DOMAIN=lab.micro-soar.internal
ID="$(date +%s)-$RANDOM"
MSGID="<factura-$ID@proveedor-pagos.test>"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > "$TMP/adjunto"

# Variante 1: mismo adjunto. Sin Responder a: no cumple la regla, va como candidato.
swaks --server 127.0.0.1 --silent 2 \
  --from "tesoreria@pagos-proveedores.test" --to "bob@$DOMAIN" \
  --header "Message-Id: <comprobante-$ID@pagos-proveedores.test>" \
  --header "From: Tesoreria <tesoreria@pagos-proveedores.test>" \
  --header "Subject: Comprobante de transferencia" \
  --body "Adjuntamos el comprobante de la transferencia realizada." \
  --attach-type application/octet-stream --attach-name comprobante.exe --attach @"$TMP/adjunto"

# Variante 2: mismo Responder a y dominio de enlace. Sin adjunto: va como candidato.
swaks --server 127.0.0.1 --silent 2 \
  --from "avisos@cobranzas-online.test" --to "alice@$DOMAIN,bob@$DOMAIN" \
  --header "Message-Id: <aviso-$ID@cobranzas-online.test>" \
  --header "From: Avisos <avisos@cobranzas-online.test>" \
  --header "Reply-To: cobranzas@pagos-urgentes.test" \
  --header "Subject: Ultimo aviso antes de la suspension" \
  --body "Evite la suspension del servicio: http://malware.testing.google.test/testing/malware/pago"

# Legitimo: nada en comun con la campana.
swaks --server 127.0.0.1 --silent 2 \
  --from "rrhh@$DOMAIN" --to "alice@$DOMAIN" \
  --header "Message-Id: <novedades-$ID@$DOMAIN>" \
  --header "Subject: Novedades de octubre" \
  --body "Les recordamos que el viernes es feriado."

# Original: el unico que cumple la regla.
swaks --server 127.0.0.1 --silent 2 \
  --from "facturacion@proveedor-pagos.test" --to "alice@$DOMAIN,bob@$DOMAIN" \
  --header "Message-Id: $MSGID" \
  --header "From: Facturacion <facturacion@proveedor-pagos.test>" \
  --header "Reply-To: cobranzas@pagos-urgentes.test" \
  --header "Subject: Factura vencida - accion requerida" \
  --body "Su factura esta vencida. Regularice el pago en http://malware.testing.google.test/testing/malware/ o descargue el adjunto." \
  --attach-type application/octet-stream --attach-name factura.exe --attach @"$TMP/adjunto"

echo "$MSGID" > /run/demo-cu03-msgid
for _ in $(seq 1 20); do
  doveadm search -u "bob@$DOMAIN" mailbox INBOX header Message-ID "$MSGID" | grep -q . && break
  sleep 0.5
done
doveadm flags add -u "bob@$DOMAIN" '\Seen' mailbox INBOX header Message-ID "$MSGID"
echo "Campana enviada: $MSGID"
'@
