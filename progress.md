# progress.md — Micro-SOAR MVP (log de trabajo)

> Diario de a bordo, append-only. Complementa a `PLAN.md` (el mapa) y
> `CLAUDE.md` (cómo trabajar). Acá va lo que PASÓ: avances, errores,
> caminos descartados. Nunca se borra: se agrega.
>
> Regla: cada sesión de trabajo agrega una entrada. Cada error o intento
> fallido se anota en "Errores y caminos descartados" para no repetirlo.

---

## Estado actual por fase
_(Actualizar el estado; el detalle va en las entradas de sesión de abajo.)_

| Fase | Estado | Nota breve |
|---|---|---|
| Fase 0 — Spike de riesgo (bloqueo vía API Wazuh) | ✅ Listo | `block_ip.py` bloqueó 8.8.8.8 de verdad (confirmado con `iptables -L` en el agente víctima). El eslabón crítico funciona. |
| Fase 1 — Camino feliz backend | 🟡 En progreso | Webhook + normalización + persistencia + `GET /incidents` validados con mock de brute-force SSH (SQLite local). Falta conectar Wazuh real. |
| Fase 2 — App consumiendo | ⬜ Pendiente | |
| Fase 3 — Step-up + enriquecimiento | ⬜ Pendiente | |
| Fase 4 — Hardening y ensayo | ⬜ Pendiente | |

Leyenda: ⬜ Pendiente · 🟡 En progreso · ✅ Listo · 🔴 Bloqueado

---

## Errores y caminos descartados
_(Antes de reintentar algo, revisar esta sección. No repetir fallas.)_

| Fecha | Qué se intentó | Resultado / por qué falló | Conclusión |
|---|---|---|---|
| _(ej.)_ 2026-08-05 | Disparar active-response vía API REST de Wazuh con token X | 401, el token no tenía permiso Y | Usar rol Z / o plan B por SSH |
| 2026-08-04 | `active-response` con `agents_list=000` (el manager) | HTTP 200 pero `error: 1`, código interno 1703 "Action not available for Manager" | El agente 000 nunca puede recibir active-response. Hace falta un agente Wazuh real registrado (instalar `wazuh-agent` apuntando a `localhost`, según `PLAN.md`). `block_ip.py` ahora toma `WAZUH_AGENT_ID` del `.env` en vez de hardcodear 000. |
| 2026-08-04 | `sudo` en la instancia de Wazuh (`cloud-init status` = `done`, `ubuntu` en grupo `sudo`) | Pide password igual, `ubuntu` no tiene password real → bloqueado sin acceso root | `cloud-init` no dejó el `NOPASSWD` esperado (causa exacta no confirmada). Se agregó `echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/99-ubuntu-nopasswd` al `user_data` de ambas instancias para no depender de eso. Requiere recrear la instancia afectada (`user_data` fuerza replace). |
| 2026-08-04 | Agente Wazuh de la víctima intentando registrarse (`authd`) | `wazuh-authd: ERROR: Incompatible version for new agent` — agente 4.14.7 vs manager v4.8.2 | El paquete `wazuh-agent` sin pinnear instala la última versión del repo apt, que no coincide con la que instaló `wazuh-install.sh` en el manager. Se pinneó `wazuh-agent=${var.wazuh_agent_version}-1` (default `4.8.2`) en el `user_data` de la víctima — si el manager cambia de versión, actualizar esa variable. |
| 2026-08-04 | `PUT /active-response` con `!firewall-drop` y `arguments: [ip]` | API devolvía `error: 0` (éxito) pero no se creaba ninguna regla en `iptables` | El script `firewall-drop` en el agente lee la IP de `alert.data.srcip`, no de `arguments`/`extra_args` (log: `Cannot read 'srcip' from data`). `block_ip.py` corregido para mandar `{"command": "!firewall-drop", "alert": {"data": {"srcip": ip}}}`. |

---

## Decisiones tomadas
_(Cambios de rumbo respecto al PLAN, con el motivo. Para defender ante el tribunal.)_

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-08-04 | Alcance = Opción A recortada, demo 5 min | Deadline 18/08, 2 personas |
| 2026-08-04 | Víctima del brute-force en VM dedicada (`aws_instance.victim`), no agente local en el manager | El agente 000 rechaza active-response (error 1703); además separa atacante → víctima → manager de forma más realista y defendible. Costo marginal (t3.micro) |

---

## Bitácora de sesiones
_(La más reciente arriba. Formato fijo por entrada.)_

### Sesión YYYY-MM-DD — <título corto>
- **Objetivo de la sesión:**
- **Hecho:**
- **En progreso / a medias:**
- **Errores encontrados:** _(replicar en la tabla de arriba si es relevante)_
- **Próximo paso concreto:**
- **Estado de instancias AWS:** _(¿quedaron stopped? importante para el costo)_

---

### Sesión 2026-08-04 — Instancia víctima + agente Wazuh (Fase 0)
- **Objetivo de la sesión:** Wazuh ya instalado (m7i-flex.large) y con
  credenciales de API funcionando. Al intentar `block_ip.py` contra el agente
  `000`, la API lo rechazó — investigar y resolver.
- **Hecho:**
  - Diagnosticado: `000` es el manager mismo, Wazuh no permite active-response
    ahí (error 1703). Hace falta un agente real.
  - Decisión: en vez de instalar el agente en el propio manager, se agrega una
    VM Ubuntu dedicada (`aws_instance.victim`, `t3.micro`) como víctima —
    separa atacante → víctima → manager, más realista para la demo y sin
    costo extra relevante.
  - Terraform (`terraform/main.tf`, `variables.tf`, `outputs.tf`): nueva
    instancia + security group (`victim`, SSH desde `my_ip`) + regla agregada
    al SG de Wazuh para permitir 1514/1515 (enrollment/eventos) desde la
    víctima. El agente se instala y se registra solo vía `user_data`, contra
    la IP privada del manager (misma VPC). `terraform validate` OK.
  - `block_ip.py` corregido: ya no hardcodea `AGENT_ID = "000"` (ahora lee
    `WAZUH_AGENT_ID` del `.env`), y ahora también valida el campo `error`
    interno de la respuesta — antes un HTTP 200 con `error: 1` se reportaba
    como éxito falso.
  - `PLAN.md` actualizado (sección 5) para reflejar la VM víctima y el tipo de
    instancia real de Wazuh (m7i-flex.large, no t3.medium).
  - `terraform apply` corrido. En el camino aparecieron y se resolvieron tres
    problemas más (ver tabla de errores): `sudo` sin `NOPASSWD` en `ubuntu`
    (se fuerza explícito en `user_data`, ya no se depende de `cloud-init`);
    la regla de SG 1514/1515 se creaba y desaparecía sola (conflicto entre
    `aws_security_group_rule` standalone y el bloque `ingress` inline del
    mismo SG — se unificó todo a inline); versión del agente (4.14.7)
    incompatible con la del manager (4.8.2) — se pinneó con
    `var.wazuh_agent_version`.
  - Agente `001` registrado y `Active`. `block_ip.py` corregido una vez más:
    `firewall-drop` lee la IP de `alert.data.srcip`, no de `arguments`.
  - **Confirmado con `iptables -L -n` en la víctima: regla `DROP` real para
    8.8.8.8.** Eslabón crítico de la Fase 0 probado end-to-end.
- **En progreso / a medias:** —
- **Errores encontrados:** ver tabla de arriba (agente 000, sudo, SG rule
  inline vs standalone, versión de agente, formato de `alert.data.srcip`).
- **Próximo paso concreto:** conectar el webhook real de Wazuh al orchestrator
  (reemplazar el mock de `mocks/wazuh_ssh_bruteforce.json` por una alerta real
  de brute-force SSH contra la víctima) — cierra el resto de la Fase 1.
- **Estado de instancias AWS:** Wazuh (`i-079a6883389c9f061`) y víctima
  (`i-0281f1168a5a87264`) **stopped** al cierre de la sesión. La víctima
  vieja (`i-0b6c3ff0fa282182d`, reemplazada por el fix de versión de agente)
  quedó `Terminated`, confirmado — no factura.

---

### Sesión 2026-08-04 — Script de bloqueo (Fase 0) + webhook backend (Fase 1)
- **Objetivo de la sesión:** Mientras se espera la instalación de Wazuh en AWS,
  avanzar en todo lo que no depende de tener el manager arriba.
- **Hecho:**
  - `orchestrator/block_ip.py`: script Fase 0 que autentica contra la API de
    Wazuh (Basic Auth → JWT) y dispara `!firewall-drop` sobre el agente `000`
    vía `PUT /active-response`. Falta probarlo contra el manager real.
  - `orchestrator/app/`: esqueleto FastAPI con `POST /api/v1/webhook/wazuh`,
    normalización de la alerta cruda a `Incident` canónico
    (`app/normalize.py`) y persistencia en SQLite (`app/database.py`,
    `app/models.py`).
  - `orchestrator/mocks/wazuh_ssh_bruteforce.json`: alerta de muestra
    (brute-force SSH) para desarrollar sin depender de Wazuh real.
  - `orchestrator/tests/test_webhook.py`: 2 tests (caso feliz + alerta con
    campos faltantes → 422). Ambos pasan.
  - Probado manualmente end-to-end vía Swagger (`/docs`): `POST` con el mock
    devuelve `201` y el `Incident` normalizado con `id` persistido.
- **En progreso / a medias:** `GET /api/v1/incidents` (falta implementar).
- **Errores encontrados:** —
- **Próximo paso concreto:** `GET /incidents`; cuando el manager de Wazuh esté
  instalado, correr `block_ip.py` contra credenciales reales y conectar el
  webhook real de Wazuh (reemplazando el mock).
- **Estado de instancias AWS:** Sin cambios (Wazuh en instalación).

---

### Sesión 2026-08-04 — Setup de planificación
- **Objetivo de la sesión:** Definir alcance, arquitectura y planificación.
- **Hecho:** Alcance (Opción A, 5 min). Terraform de infra listo.
  `PLAN.md`, `CLAUDE.md` y este `progress.md` creados.
- **En progreso / a medias:** —
- **Errores encontrados:** —
- **Próximo paso concreto:** Fase 0 — `terraform apply`, instalar Wazuh, y
  probar bloqueo de IP vía API de Wazuh desde curl.
- **Estado de instancias AWS:** Aún no creadas.