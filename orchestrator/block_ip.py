"""
Spike Fase 0: bloquear una IP en un agente Wazuh vía la API.
Hilo dorado: auth -> token JWT -> PUT /active-response.

El agente 000 es el manager mismo y Wazuh rechaza active-response ahí
(error 1703) — el agente objetivo tiene que ser un agente real registrado.
"""
import os
import sys

import requests
import urllib3
from dotenv import load_dotenv

# El manager usa un certificado autofirmado por defecto en un spike/lab.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ATTACKER_IP = "8.8.8.8"


def authenticate(host: str, user: str, password: str) -> str:
    url = f"{host}/security/user/authenticate"
    try:
        resp = requests.get(url, auth=(user, password), verify=False, timeout=10)
    except requests.exceptions.RequestException as e:
        sys.exit(f"No se pudo conectar a {host}: {e}")

    if resp.status_code != 200:
        sys.exit(f"Login rechazado ({resp.status_code}): {resp.text}")

    return resp.json()["data"]["token"]


def block_ip(host: str, token: str, agent_id: str, ip: str) -> None:
    url = f"{host}/active-response"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"agents_list": agent_id}
    # El script firewall-drop lee la IP de alert.data.srcip, no de "arguments"
    # (el mismo campo que ya usa app/normalize.py para alertas reales de Wazuh).
    body = {"command": "!firewall-drop", "alert": {"data": {"srcip": ip}}}

    try:
        resp = requests.put(
            url, headers=headers, params=params, json=body, verify=False, timeout=10
        )
    except requests.exceptions.RequestException as e:
        sys.exit(f"No se pudo enviar el active-response: {e}")

    if resp.status_code != 200:
        sys.exit(f"El comando fue rechazado ({resp.status_code}): {resp.text}")

    # La API de Wazuh puede devolver HTTP 200 con la acción rechazada
    # (ver data.failed_items / error != 0) en vez de un status code de error.
    result = resp.json()
    if result.get("error") or result["data"]["total_failed_items"] > 0:
        sys.exit(f"El comando fue rechazado: {result}")

    print(f"IP {ip} bloqueada en agente {agent_id}: {result}")


def main() -> None:
    load_dotenv()
    host = os.environ["WAZUH_HOST"]
    user = os.environ["WAZUH_USER"]
    password = os.environ["WAZUH_PASSWORD"]
    agent_id = os.environ["WAZUH_AGENT_ID"]

    token = authenticate(host, user, password)
    block_ip(host, token, agent_id, ATTACKER_IP)


if __name__ == "__main__":
    main()
