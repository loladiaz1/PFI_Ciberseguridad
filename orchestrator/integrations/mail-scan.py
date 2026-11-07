#!/usr/bin/env python3
# Regla de correo de laboratorio (CU-03). Corre en el mail server como servicio
# (mail-scan.service): revisa la bandeja de entrada de cada buzon y, si un
# correo cumple la regla, escribe una linea JSON que el agente de Wazuh levanta
# de /var/log/mail-scan.json. Wazuh solo transporta: la deteccion es esta regla.
# No es un antispam ni reemplaza a Rspamd.
#
# Regla (AND estricto): adjunto ejecutable y "Responder a" de otro dominio.
#
# Payload minimo (message_id, mailbox, reason, delivered_at): el orchestrator
# baja el correo por IMAP y lo lee con su propio parser (src/emailParse.js).
#
# Se revisan new/ y cur/: Dovecot pasa el archivo a cur/ en cuanto un cliente
# sincroniza la carpeta, asi que mirar solo new/ pierde correos.

import json
import os
import sys
import time
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr

ROOT = os.environ.get("MAIL_SCAN_ROOT", "/var/vmail")
LOG_PATH = os.environ.get("MAIL_SCAN_LOG", "/var/log/mail-scan.json")
# El buzon de reportes trae correos reenviados como adjunto: no es un destinatario.
SKIP = set(os.environ.get("MAIL_SCAN_SKIP", "phishing").split(","))
POLL_SECONDS = 1
REASON = "Adjunto ejecutable y Responder a de otro dominio"
EXECUTABLE = (".exe", ".scr", ".bat", ".cmd", ".com", ".pif", ".vbs", ".js", ".jar", ".msi", ".ps1", ".hta", ".lnk")


def inbox_files(root=ROOT):
    """(buzon, ruta) de cada correo de la bandeja de entrada de cada buzon."""
    found = []
    for domain in sorted(os.listdir(root)):
        domain_path = os.path.join(root, domain)
        if not os.path.isdir(domain_path):
            continue
        for user in sorted(os.listdir(domain_path)):
            if user in SKIP:
                continue
            for folder in ("new", "cur"):
                path = os.path.join(domain_path, user, "Maildir", folder)
                if not os.path.isdir(path):
                    continue
                found.extend((f"{user}@{domain}", os.path.join(path, name)) for name in sorted(os.listdir(path)))
    return found


def file_key(path):
    # El nombre base no cambia al pasar de new/ a cur/ (cur/ le suma ":2,S").
    return os.path.basename(path).split(":")[0]


def domain_of(header):
    address = parseaddr(str(header or ""))[1].lower()
    return address.rsplit("@", 1)[1] if "@" in address else None


def has_executable(message):
    # Solo adjuntos directos: un .eml adjunto no cuenta por lo que trae adentro.
    for part in message.iter_attachments():
        name = (part.get_filename() or "").lower()
        if name.endswith(EXECUTABLE):
            return True
    return False


def matches(message):
    sender = domain_of(message["From"])
    reply_to = domain_of(message["Reply-To"])
    return bool(sender and reply_to and sender != reply_to and has_executable(message))


def parse(path):
    with open(path, "rb") as f:
        return BytesParser(policy=policy.default).parse(f)


def event(mailbox, message_id):
    delivered_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {"scanner": "mail-scan", "message_id": message_id, "mailbox": mailbox, "reason": REASON, "delivered_at": delivered_at}


def scan(seen_files, seen_ids, log):
    for mailbox, path in inbox_files():
        key = file_key(path)
        if key in seen_files:
            continue
        try:
            message = parse(path)
        except FileNotFoundError:
            continue  # lo movieron entre el listado y la lectura: sigue en la proxima pasada
        except Exception as err:
            print(f"mail-scan: no se pudo leer {path}: {err}", file=sys.stderr)
            seen_files.add(key)
            continue
        seen_files.add(key)
        try:
            message_id = "".join(str(message["Message-ID"] or "").split())
            if not message_id or message_id in seen_ids or not matches(message):
                continue
        except Exception as err:
            print(f"mail-scan: encabezados invalidos en {path}: {err}", file=sys.stderr)
            continue
        # Para toda la vida del proceso: el mismo correo llega a varios buzones,
        # y uno restaurado desde cuarentena no reabre el caso.
        seen_ids.add(message_id)
        log.write(json.dumps(event(mailbox, message_id)) + "\n")
        log.flush()


def main():
    # Lo que ya estaba al arrancar no se analiza: solo correo nuevo.
    seen_files = {file_key(path) for _, path in inbox_files()}
    seen_ids = set()
    with open(LOG_PATH, "a", encoding="utf-8") as log:
        while True:
            scan(seen_files, seen_ids, log)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
