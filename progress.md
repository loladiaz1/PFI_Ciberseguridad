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
| Fase 0 — Spike de riesgo (bloqueo vía API Wazuh) | 🟡 En progreso | Script `block_ip.py` listo; falta correrlo contra el manager real (esperando instalación). |
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

---

## Decisiones tomadas
_(Cambios de rumbo respecto al PLAN, con el motivo. Para defender ante el tribunal.)_

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-08-04 | Alcance = Opción A recortada, demo 5 min | Deadline 18/08, 2 personas |

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