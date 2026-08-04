"""
Spike Fase 0: bloquear una IP en el agente 000 (el propio manager) vía la
API de Wazuh. Hilo dorado: auth -> token JWT -> PUT /active-response.
"""
import os
import sys

import requests
import urllib3
from dotenv import load_dotenv

# El manager usa un certificado autofirmado por defecto en un spike/lab.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

AGENT_ID = "000"
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
    body = {"command": "!firewall-drop", "arguments": [ip]}

    try:
        resp = requests.put(
            url, headers=headers, params=params, json=body, verify=False, timeout=10
        )
    except requests.exceptions.RequestException as e:
        sys.exit(f"No se pudo enviar el active-response: {e}")

    if resp.status_code != 200:
        sys.exit(f"El comando fue rechazado ({resp.status_code}): {resp.text}")

    print(f"IP {ip} bloqueada en agente {agent_id}: {resp.json()}")


def main() -> None:
    load_dotenv()
    host = os.environ["WAZUH_HOST"]
    user = os.environ["WAZUH_USER"]
    password = os.environ["WAZUH_PASSWORD"]

    token = authenticate(host, user, password)
    block_ip(host, token, AGENT_ID, ATTACKER_IP)


if __name__ == "__main__":
    main()
