#!/usr/bin/env python3
# Integracion custom de Wazuh: reenvia la alerta cruda (JSON) al webhook del
# orchestrator (POST /api/v1/webhook/wazuh). Invocado por el wrapper
# custom-microsoar, que a su vez invoca Wazuh via <integration> en ossec.conf.
#
# Args (convencion estandar de las integraciones custom de Wazuh):
#   argv[1] = ruta al archivo con la alerta (JSON, por alert_format=json)
#   argv[2] = hook_url (viene de <hook_url> en ossec.conf)


#[ Wazuh (analysisd) ] ──> 1. Ejecuta Script Shell ──> 2. Llama a Script Python ──> 3. POST JSON ──> [ Webhook SOAR ]

import json
import sys
import urllib.error
import urllib.request

def main():
    alert_file_path = sys.argv[1]
    webhook_url = sys.argv[2]

    with open(alert_file_path) as f:
        alert = json.load(f)

    body = json.dumps(alert).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as err:
        # El body trae el detalle real (p.ej. {"detail": "Campo faltante..."}),
        # no solo el status HTTP -- sin esto solo se ve "HTTP Error 422:
        # Unprocessable Entity" en ossec.log, que no dice cual campo fallo.
        sys.exit(f"custom-microsoar: {webhook_url} devolvio {err.code}: {err.read().decode()}")
    except Exception as err:
        sys.exit(f"custom-microsoar: fallo el POST a {webhook_url}: {err}")

if __name__ == "__main__":
    main()
