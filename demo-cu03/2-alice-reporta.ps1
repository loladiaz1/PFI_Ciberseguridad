# Salida A: alice reporta el correo que ya le llego (.eml adjunto a phishing@).
# Mismo Message-ID que el script 1. No correrlo mientras la alerta de la regla
# todavia pueda llegar: las dos rutas a la vez pueden abrir dos incidentes.
. "$PSScriptRoot\_ssm.ps1"

Invoke-Mail @'
#!/bin/bash
set -euo pipefail
DOMAIN=lab.micro-soar.internal
MSGID=$(cat /run/demo-cu03-msgid)
ALICE="/var/vmail/$DOMAIN/alice/Maildir"
FILE=$(grep -rlF "$MSGID" "$ALICE/new" "$ALICE/cur" | head -n1 || true)
[ -n "$FILE" ] || { echo "El correo no esta en el buzon de alice" >&2; exit 1; }
swaks --server 127.0.0.1 --silent 2 \
  --from "alice@$DOMAIN" --to "phishing@$DOMAIN" \
  --header "Subject: Posible phishing" \
  --body "Me llego esto y parece falso." \
  --attach-type message/rfc822 --attach-name original.eml --attach @"$FILE"
echo "Reportado por alice: $MSGID"
'@
