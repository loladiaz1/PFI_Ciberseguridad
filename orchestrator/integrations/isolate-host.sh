#!/bin/sh
# Active-response custom de Wazuh para CU-02 (aislar endpoint infectado).
# Se instala en el AGENTE (la victima), en /var/ossec/active-response/bin/,
# y se registra en el ossec.conf del MANAGER con:
#
#   <command>
#     <name>isolate-host</name>
#     <executable>isolate-host.sh</executable>
#     <timeout_allowed>yes</timeout_allowed>
#   </command>
#
# Se invoca igual que firewall-drop (PUT /active-response, agents_list=<id>),
# pero sin IP objetivo: aisla al propio agente que ejecuta el script.
#
# A diferencia de firewall-drop (que agrega/quita una regla DROP puntual
# sobre una IP atacante), esto corta TODO el trafico del host salvo:
# loopback, conexiones ya establecidas, y el propio manager de Wazuh
# (para no perder el canal que permite revertir el aislamiento despues).
#
# Contrato de active-response de Wazuh: recibe un JSON por stdin con
# {"command": "add"|"delete", ...}. "add" aisla, "delete" revierte.

CHAIN="MICROSOAR_ISOLATE"
LOCK_FILE="/tmp/isolate-host.lock"

read -r INPUT_JSON

case "${INPUT_JSON}" in
    *'"command":"add"'*|*'"command": "add"'*)
        ACTION="add"
        ;;
    *'"command":"delete"'*|*'"command": "delete"'*)
        ACTION="delete"
        ;;
    *)
        echo "isolate-host: comando desconocido en ${INPUT_JSON}" >&2
        exit 1
        ;;
esac

# IP del manager: se lee del propio ossec.conf del agente, no viene por
# parametro -- asi el script es autocontenido y no depende de que el
# orchestrator conozca la IP privada del manager.
MANAGER_IP=$(grep -A2 '<server>' /var/ossec/etc/ossec.conf | grep '<address>' | head -1 | sed -e 's/.*<address>//' -e 's/<\/address>.*//')

if [ "${ACTION}" = "add" ]; then
    flock "${LOCK_FILE}" -c "
        iptables -N ${CHAIN} 2>/dev/null
        iptables -F ${CHAIN}
        iptables -A ${CHAIN} -i lo -j RETURN
        iptables -A ${CHAIN} -m state --state ESTABLISHED,RELATED -j RETURN
        if [ -n '${MANAGER_IP}' ]; then
            iptables -A ${CHAIN} -d ${MANAGER_IP} -j RETURN
            iptables -A ${CHAIN} -s ${MANAGER_IP} -j RETURN
        fi
        iptables -A ${CHAIN} -j DROP
        iptables -C INPUT -j ${CHAIN} 2>/dev/null || iptables -I INPUT -j ${CHAIN}
        iptables -C OUTPUT -j ${CHAIN} 2>/dev/null || iptables -I OUTPUT -j ${CHAIN}
    "
else
    flock "${LOCK_FILE}" -c "
        iptables -D INPUT -j ${CHAIN} 2>/dev/null
        iptables -D OUTPUT -j ${CHAIN} 2>/dev/null
        iptables -F ${CHAIN} 2>/dev/null
        iptables -X ${CHAIN} 2>/dev/null
    "
fi

exit 0
