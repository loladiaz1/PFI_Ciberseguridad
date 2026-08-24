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
| Fase 0 — Spike de riesgo (bloqueo vía API Wazuh) | ✅ Listo | Revalidado el 21/08 contra infra recreada de cero (ver sesión). El eslabón crítico sigue funcionando. |
| Fase 1 — Camino feliz backend | 🟡 En progreso | Webhook + normalización + persistencia + `GET /incidents` deployados y corriendo en AWS (`pm2`), validados end-to-end. Falta conectar el webhook a alertas reales de Wazuh (`ossec.conf` + `custom-microsoar`) — hoy se sigue inyectando el incidente a mano vía `curl`. |
| Fase 2 — App consumiendo | ✅ Listo | Login, lista, detalle y bloqueo probados de punta a punta desde un celular real, por Tailscale, contra el orchestrator en AWS. |
| Fase 3 — Step-up + enriquecimiento | 🟡 En progreso | Step-up con biometría real (`expo-local-authentication`) probado y funcionando. Falta enriquecimiento VT/AbuseIPDB y audit log (`activity.tsx` sigue con datos mock). |
| Fase 4 — Hardening y ensayo | 🟡 En progreso | Security group del orchestrator confirmado cerrado (puerto 8000 solo por Tailscale, no por IP pública). Falta: video de respaldo, ensayo cronometrado. |

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
| 2026-08-21 | `curl -sO https://packages.wazuh.com/4.x/wazuh-install.sh` en el `user_data` del manager (`terraform/user_data_wazuh.sh`) | `4.x` es un placeholder de la documentación de Wazuh, nunca se reemplazó por una versión real — la URL devolvía un XML de "Access Denied" de S3, que se ejecutaba como si fuera el script bash. El manager nunca se instalaba, `cloud-init status` quedaba en `error`. | Fijar versión real (`4.8`, mismo major.minor que `wazuh_agent_version`) en la URL. |
| 2026-08-21 | `terraform apply` después de corregir `user_data_wazuh.sh`, sin `-replace` | El plan mostraba "update in-place": este proveedor de AWS no vuelve a ejecutar `user_data` en una instancia ya viva cuando cambia su contenido, solo actualiza el valor guardado en el state. La instancia rota seguía rota. | Usar `terraform apply -replace="aws_instance.X"` para forzar la recreación real cuando cambia `user_data` de una instancia que ya está corriendo. |
| 2026-08-21 | `rsync` para copiar `orchestrator/` a la instancia del orchestrator, desde PowerShell y desde Git Bash en Windows | No está instalado en ninguno de los dos. | Empaquetar con `tar --exclude=node_modules --exclude=.env`, subir con `scp`, extraer con `tar -xzf` del lado del servidor. |
| 2026-08-21 | Copiar `orchestrator/soar.db` tal cual (dentro del `tar` de deploy) y despues limpiarlo con `rm soar.db` en la raíz del proyecto en el servidor | Prisma resuelve `file:./soar.db` (de `DATABASE_URL` en `.env`) relativo a la carpeta de `prisma/schema.prisma`, no a la raíz del proyecto — el archivo real vivía en `orchestrator/prisma/soar.db`. El primer intento de limpieza borraba un archivo que no era el real; encima quedaban `-wal`/`-shm` que hacían "reaparecer" los datos viejos al recrear el `.db` principal. | Al limpiar una SQLite de Prisma: borrar `prisma/*.db*` (no solo `*.db` en la raíz del proyecto), incluyendo `-journal`/`-wal`/`-shm`, y excluir `soar.db` del `tar` de deploy en el futuro (junto con `.env`). |
| 2026-08-21 | `BottomNav` cambiaba de "pestaña" con `router.push()` sobre un `Stack` navigator (no un `Tabs`) | `push` apila una pantalla nueva cada vez en vez de cambiar entre pestañas existentes: cada tap remontaba la pantalla entera y volvía a pedir los datos a la API — se sentía como si recargara toda la app. | `dashboard`, `incidents`, `activity`, `profile` movidos a `app/(tabs)/` con un `Tabs` real de expo-router + `components/TabBar.tsx` custom que usa `navigation.navigate()`. De paso se encontró que `app/(tabs)/index.tsx` (boilerplate de Expo sin usar) pisaba la misma ruta `/` que el login — se borró junto con `explore.tsx`. |

---

## Decisiones tomadas
_(Cambios de rumbo respecto al PLAN, con el motivo. Para defender ante el tribunal.)_

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-08-04 | Alcance = Opción A recortada, demo 5 min | Deadline 18/08, 2 personas |
| 2026-08-04 | Víctima del brute-force en VM dedicada (`aws_instance.victim`), no agente local en el manager | El agente 000 rechaza active-response (error 1703); además separa atacante → víctima → manager de forma más realista y defendible. Costo marginal (t3.micro) |
| 2026-08-04 | Orchestrator migrado de Python/FastAPI a Node.js/Express + Prisma | El documento de propuesta (ya entregado/evaluado) especifica Node.js v18+, Express, Axios, JWT. Se había arrancado en Python por simplicidad del spike, pero al confirmar que el documento ya fue evaluado había que alinear la implementación. Se reescribió todo (Fase 0 y Fase 1) antes de sumar más código sobre la base equivocada. |
| 2026-08-21 | Deadline de demo movido al 1 de septiembre de 2026 (el original de `PLAN.md` era el 18/08) | Entre el 06/08 y el 21/08 se corrió un `terraform destroy` que dejó la infra de AWS en cero, y nada de lo construido después (instancia dedicada del orchestrator, Tailscale, la app terminada) se había probado nunca contra infraestructura real hasta esta sesión. `PLAN.md` todavía no está actualizado con la fecha nueva. |
| 2026-08-21 | La instancia del orchestrator no se destruye/recrea junto con Wazuh y la víctima — se para y prende (`stop`/`start`) | Su identidad de Tailscale (IP `100.x.y.z`) vive en el disco de la instancia; recrearla la cambia y obliga a actualizar `AppMicroSOAR/.env` y limpiar el dispositivo viejo del admin console. `stop`/`start` la preserva. Wazuh y la víctima sí se pueden destruir/recrear libremente (no dependen de Tailscale). |
| 2026-08-24 | `origin/unificacion-backend-frontend` (Lola) se descarta entera, no se mergea nada — ni siquiera pulido visual archivo por archivo. `test1` queda como única base. | `git merge-tree` (dry run) dio 0 conflictos textuales, pero la branch reimplementó lo mismo de forma incompatible: backend MVC propio sin la integración real de Wazuh (`AppMicroSOAR/backend/orchestrator/`), otra reestructuración de rutas de expo-router, y borra `services/{http,tokenStore}.ts` que `test1` sí usa. Un merge automático hubiera dejado dos backends y dos routings coexistiendo sin error visible. Ajustes de diseño se hacen después, a mano, sobre `test1`. Pendiente: avisarle a Lola para que no siga sumando commits en esa branch. |

---

## Bitácora de sesiones
_(La más reciente arriba. Formato fijo por entrada.)_

### Sesión 2026-08-24 — Consolidar branches, descartar frontend de Lola, decisiones de tesis pendientes
- **Objetivo de la sesión:** `main` seguía parado en "react native front" (06/08)
  mientras todo lo real vivía en `test1`, y `test1` divergía hacía 3 semanas de
  `unificacion-backend-frontend` (Lola) sin que nadie decidiera qué hacer.
  Resolver antes de seguir sumando código.
- **Hecho:**
  - Confirmado que `origin/unificacion-backend-frontend` siguió avanzando en
    paralelo sin loguear (`7660607` "cambio de diseño" 15/08, `41a42f3` "fix"
    15/08, `a74e4f3` "face id" 16/08) — 3 commits más desde la última vez que
    se había mirado.
  - `git merge-tree` (dry run, sin tocar el repo) entre `test1` y esa branch:
    **0 conflictos textuales**, pero engañoso — reimplementaron lo mismo de
    forma incompatible en rutas distintas: `AppMicroSOAR/backend/orchestrator/`
    (backend MVC propio, sin `wazuh.js`/`auth.js`/`custom-microsoar.py` reales),
    otra reestructuración de expo-router (mueve `dashboard.tsx` fuera de
    `(tabs)/`, distinto de como quedó en la sesión 21/08), y borra
    `services/{http,tokenStore}.ts` que `test1` sí usa. Un merge automático
    hubiera dejado dos backends y dos routings coexistiendo sin error visible.
  - Revisado el commit `a74e4f3` ("face id") en detalle: agrega
    `AppMicroSOAR/app/biometric.tsx`, pantalla de step-up genérica y reusable
    (`redirect`/`fallback` por query param) que pide biometría **después** de
    `/confirm`. No se adopta: depende de `components/ui/BrandHeader.tsx`, que
    no existe en `test1` (viene de commits previos de esa branch, no
    incluidos en el diff), y duplicaría el step-up — `test1` ya lo hace
    **antes** de `/confirm` (`app/auth.tsx`, probado end-to-end el 21/08,
    `DROP` real confirmado). El patrón genérico de `biometric.tsx` queda
    anotado como mejor diseño a futuro, no para ahora.
  - **Decisión: `unificacion-backend-frontend` se descarta entera, no se trae
    nada** (ver tabla de decisiones). `test1` queda como única base.
  - Confirmado que `main` es ancestro directo de `test1`
    (`git merge-base --is-ancestor main test1` → sí) — el fast-forward
    `main`←`test1` es trivial, sin riesgo de conflicto. **Instrucciones dadas,
    push todavía no ejecutado** (queda para cuando el usuario lo corra).
  - Encontrados sin loguear en su momento: `DIAGRAMAS.md` se actualizó el
    16/08 (bloque Four-Eyes en el diagrama de secuencia, escala de alcance
    🔴 checkpoint garantizado / ⚪ candidato si sobra tiempo / 🔵 producto
    final, nota de que el 18/08 es checkpoint intermedio, no entrega final);
    y aparecieron en el repo `E25-PFI-Diaz-Perversi-MICRO-SOAR.pdf` (la
    propuesta real, antes no estaba en el repo) y `TESIS_CAPITULOS.md`, que
    cruza la propuesta contra el código y deja marcadas dos discrepancias sin
    resolver: **(1) stack** — la propuesta pide Android nativo Kotlin +
    Jetpack Compose, el código es Expo/React Native, sin justificar todavía
    (mismo tipo de tensión que se resolvió una vez para el backend,
    Python→Node, pero en sentido inverso); **(2) alcance formal** — la
    propuesta compromete 3 PoC (fuerza bruta + aislar endpoint CU-02 +
    phishing CU-03), el plan actual cubre 1 solo, y CU-03 no tiene ninguna
    Historia de Usuario que lo respalde. Ninguna de las dos es un problema de
    código — son decisiones de equipo que bloquean escribir el capítulo 7 de
    la tesis.
- **En progreso / a medias:** fast-forward `main`←`test1` decidido, no
  ejecutado todavía. Decisión de stack (Kotlin vs RN) y de alcance (1 vs 3
  PoC) sin resolver, no bloquean el código de acá al 1/9 pero sí la
  redacción de la tesis.
- **Errores encontrados:** —
- **Próximo paso concreto:** ejecutar el fast-forward y pushear `main`;
  avisarle a Lola que su branch quedó descartada; después, conectar el
  webhook real de Wazuh (sigue siendo el próximo paso técnico de la sesión
  21/08, no cambió).
- **Estado de instancias AWS:** sin cambios en esta sesión (no se tocó
  infra) — seguían `stopped` desde el cierre del 21/08, confirmar antes de
  la próxima prueba end-to-end.

---

### Sesión 2026-08-21 — Recuperar la infra desde cero, deploy del orchestrator y primer end-to-end real desde el celular
- **Objetivo de la sesión:** el demo se corrió al 1/9. Retomar después de casi
  dos semanas sin commits de código; validar cuánto de lo construido
  (migración a Node, app terminada, Terraform del orchestrator) funciona de
  verdad, no solo en el papel.
- **Hecho:**
  - Diagnóstico inicial: `terraform.tfstate` estaba vacío — se había corrido
    un `destroy` el 06/08. Ninguna instancia existía. Confirmado con
    `aws ec2 describe-instances` en varias regiones.
  - `terraform apply` desde cero. El manager de Wazuh no arrancó
    (`cloud-init status: error`) — causa raíz: bug real en
    `user_data_wazuh.sh` (`4.x` literal en la URL del instalador, ver tabla
    de errores). Corregido a `4.8` y reemplazadas las instancias de Wazuh y
    víctima con `terraform apply -replace` (un `apply` normal no alcanza,
    ver tabla de errores).
  - Tailscale conectado a mano por SSH en el orchestrator
    (`tailscale up --authkey=...`) porque el `tailscale_authkey` se agregó a
    `terraform.tfvars` después de que la instancia ya había arrancado.
    Confirmado en el admin console, IP `100.68.30.31`.
  - `AppMicroSOAR/.env` tenía `EXPO_PUBLIC_API_URL` duplicada (`localhost` y
    la IP de Tailscale) — `dotenv` toma la primera ocurrencia, no la última,
    así que la app hubiera seguido usando `localhost`. Corregido.
  - Credenciales nuevas de la API de Wazuh (regeneradas con la instancia)
    extraídas y cargadas en `orchestrator/.env`. `block_ip.js` revalidado
    contra la infra nueva: `DROP` real confirmado en `iptables` de la
    víctima para `8.8.8.8`.
  - Deploy del orchestrator a su instancia AWS: código empaquetado con `tar`
    (sin `rsync`, no está en Windows) + `scp`, `.env` propio con
    `WAZUH_HOST` en la IP **privada** de Wazuh, `npm ci` + `prisma db push`
    + `pm2 start` + `pm2 startup` (para que sobreviva a un reinicio de la
    instancia). Confirmado: responde por `localhost` y por su IP de
    Tailscale, y **no** responde por su IP pública (Zero Trust del PLAN
    confirmado en la práctica).
  - Encontrado y limpiado: la base SQLite copiada en el deploy tenía datos
    viejos de pruebas locales — causa raíz fue que Prisma resuelve
    `file:./soar.db` relativo a `prisma/`, no a la raíz del proyecto (ver
    tabla de errores). Base limpiada, un incidente de prueba inyectado a
    mano vía `curl` al webhook (agente `001` real, IP de prueba
    `198.51.100.23` del rango reservado para documentación).
  - **Primer end-to-end real desde el celular:** login → dashboard →
    incidente → step-up biométrico real → confirm → bloqueo → success.
    Confirmado con `iptables -L -n` en la víctima: `DROP` real para
    `198.51.100.23`. Es la primera vez que corre el hilo dorado completo
    desde un dispositivo real, no desde un script.
  - Bug de UX encontrado y corregido: `BottomNav` cambiaba de pestaña con
    `router.push()` sobre un `Stack`, no un `Tabs` — cada tap remontaba la
    pantalla y volvía a pedir datos a la API (se sentía como si recargara
    toda la app). Reestructurado: `dashboard`/`incidents`/`activity`/`profile`
    movidos a `app/(tabs)/` con un `Tabs` real + `components/TabBar.tsx`
    custom. De paso se sacó el boilerplate de Expo (`(tabs)/index.tsx`,
    `explore.tsx`) que pisaba la ruta `/` del login. `tsc --noEmit` pasa
    limpio después del cambio.
  - Único cambio de código de la sesión con el fix de `user_data_wazuh.sh`:
    todo lo demás (Terraform apply, Tailscale, credenciales, deploy) fue
    operar infraestructura ya escrita, no reescribirla.
- **En progreso / a medias:** ajustes de UI pendientes (el usuario los deja
  para la próxima sesión, sin detalle todavía).
- **Errores encontrados:** ver tabla de arriba (URL de Wazuh con `4.x`,
  `user_data` no fuerza replace, sin `rsync` en Windows, ruta de la SQLite
  de Prisma, `router.push` vs `Tabs`).
- **Próximo paso concreto:** conectar el webhook real de Wazuh
  (`ossec.conf` + `integrations/custom-microsoar`) para que una alerta real
  de fuerza bruta cree el incidente sola, sin inyección manual. Después:
  video de respaldo y ensayo cronometrado. `PLAN.md` todavía tiene el
  deadline viejo (18/08) — actualizar a mano cuando se retome.
- **Estado de instancias AWS:** las 3 (`micro-soar-wazuh`,
  `micro-soar-victim`, `micro-soar-orchestrator`) quedaron **stopped** al
  cierre de la sesión (`aws ec2 stop-instances`). Al volver a prenderlas,
  la IP pública de cada una cambia (no hay Elastic IP) — la de Tailscale del
  orchestrator no cambia. `pm2` resucita solo gracias a `pm2 startup`.

---

### Sesión 2026-08-04 — Migración del orchestrator a Node.js/Express
- **Objetivo de la sesión:** El documento de propuesta del PFI (ya entregado
  y evaluado) especifica Node.js + Express + Axios + JWT + PostgreSQL/Redis.
  El orchestrator se había construido en Python/FastAPI. Alinear la
  implementación al documento antes de seguir sumando funcionalidad.
- **Hecho:**
  - Backend reescrito completo en Node.js v18+/Express: `src/app.js`
    (`POST /api/v1/webhook/wazuh`, `GET /api/v1/incidents`),
    `src/normalize.js` (misma lógica de normalización que antes),
    `src/db.js` + `prisma/schema.prisma` (Prisma ORM, SQLite en dev — cambiar
    a PostgreSQL cuando exista la instancia es solo cambiar el provider y la
    `DATABASE_URL`, igual que con SQLAlchemy).
  - `block_ip.js`: mismo hilo dorado que `block_ip.py` (auth JWT vía Axios +
    `PUT /active-response`), incluida la corrección de `alert.data.srcip`.
  - Tests portados a Jest + Supertest (`tests/webhook.test.js`), 3/3 en
    verde, mismos casos que la suite de pytest anterior.
  - Archivos Python eliminados (`block_ip.py`, `app/`, `requirements.txt`,
    `.venv/`, tests de pytest) — quedan en el historial de git si hace falta
    consultarlos.
  - `README.md`, `.gitignore` actualizados para reflejar el stack Node.
  - **Validación completa post-migración, antes de pushear:**
    - Fase 1: `npm test` (3/3 verde) + prueba manual en vivo (servidor real
      arriba, `curl` contra `POST /api/v1/webhook/wazuh` y
      `GET /api/v1/incidents`) — funciona igual que con FastAPI.
    - Instancias de Wazuh y víctima prendidas de nuevo (estaban `stopped`).
      Como no hay Elastic IP, la IP pública cambió al prenderlas — se
      actualizó `WAZUH_HOST` en `.env` a la nueva IP.
    - Fase 0: `node block_ip.js` contra el manager real → `error: 0`, sin
      `failed_items`. Confirmado con `sudo iptables -L -n` en la víctima:
      regla `DROP` real para 8.8.8.8. **El puerto de Node.js reproduce el
      comportamiento exacto de la versión Python.**
- **En progreso / a medias:** —
- **Errores encontrados:** —
- **Próximo paso concreto:** conectar el webhook real de Wazuh (reemplazar
  el mock), cierra el resto de la Fase 1. Después: commitear y pushear la
  migración a Node.
- **Estado de instancias AWS:** Wazuh y víctima **running** (prendidas para
  esta validación). **Recordatorio: pararlas de nuevo al terminar.**

---

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