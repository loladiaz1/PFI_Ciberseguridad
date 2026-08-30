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
| Fase 1 — Camino feliz backend | ✅ Listo | Webhook conectado a Wazuh real (`ossec.conf` + `integrations/custom-microsoar`). Un brute-force SSH real crea el incidente solo, sin inyección manual — confirmado el 26/08. |
| Fase 2 — App consumiendo | ✅ Listo | Login, lista, detalle y bloqueo probados de punta a punta desde un celular real, por Tailscale, contra el orchestrator en AWS. |
| Fase 3 — Step-up + enriquecimiento | 🟡 En progreso | Step-up con biometría real funcionando. Audit log real agregado (`GET /api/v1/audit`, `activity.tsx` conectado — 30/08). Falta solo el enriquecimiento VT/AbuseIPDB. |
| Fase 4 — Hardening y ensayo | 🟡 En progreso | Security group del orchestrator confirmado cerrado (puerto 8000 solo por Tailscale, no por IP pública). Rate limiting de `/auth/login` ajustado a 20 intentos/15min (30/08, ver errores). Falta: video de respaldo, ensayo cronometrado. |

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
| 2026-08-26 | Agregar ingress al SG del orchestrator referenciando `aws_security_group.wazuh.id` (para que el manager le llegue al webhook) | `Error: Cycle` — el SG de Wazuh ya referenciaba al del orchestrator (regla del puerto 55000), y ambos usan bloques `ingress` inline: una referencia cruzada entre dos SG con reglas inline en ambos lados es un ciclo que Terraform no puede resolver. | Usar `cidr_blocks = [data.aws_vpc.default.cidr_block]` en vez de `security_groups = [...]` para esa regla puntual — evita el ciclo sin tocar las reglas que ya funcionaban (convertir la regla existente a `aws_security_group_rule` standalone hubiera reintroducido el bug ya documentado arriba, del 04/08, de reglas standalone mezcladas con bloques inline en el mismo SG). |
| 2026-08-26 | `terraform plan` con las 3 instancias `stopped`, después de un cambio no relacionado (el SG del punto anterior) | El plan quería **reemplazar las 3 instancias** (`associate_public_ip_address = false -> true # forces replacement`) — casi se aplica sin mirar el detalle. | `associate_public_ip_address` solo aplica al lanzar la instancia; con la instancia parada (sin IP pública en ese momento), la API de AWS lo devuelve `false` y Terraform lo interpreta como drift real. Se agregó `lifecycle { ignore_changes = [associate_public_ip_address] }` a las 3 `aws_instance` — fix permanente, si no iba a repetirse cada vez que se toque Terraform con las instancias paradas (que es el hábito de ahorro de costo del equipo). |
| 2026-08-26 | Subir `orchestrator/integrations/custom-microsoar` y `.py` al manager (`scp` + `chown root:wazuh` + `chmod 750`, mismo patrón que `slack`/`pagerduty` ya instalados) | `wazuh-integratord: ERROR: Couldn't execute command (...). Check file and permissions.` — mensaje genérico, no decía la causa real. | Los dos archivos tenían fin de línea CRLF (Windows) en el repo. El shebang quedaba `#!/bin/sh\r`, un intérprete que no existe — el kernel no puede hacer `exec()`. Confirmado con `cat -A`. Corregido con `sed -i 's/\r$//'` en ambos archivos, y agregado `.gitattributes` (`orchestrator/integrations/* text eol=lf`, `*.sh text eol=lf`) para que no vuelva a pasar en un checkout futuro en Windows. |
| 2026-08-26 | Primer intento de brute-force real (loop de `ssh` con `PubkeyAuthentication=no` contra la víctima) para probar la integración | La regla compuesta de fuerza bruta de Wazuh (`5712`, nivel 10) nunca disparó — la app nunca vio el incidente. | La AMI de Ubuntu deshabilita `PasswordAuthentication` por default (`/etc/ssh/sshd_config.d/60-cloudimg-settings.conf`). Sin eso, sshd cierra la conexión en preauth sin generar líneas `Failed password`, que es lo que necesita la regla `5712` (`frequency=8` de la regla `5710` en 120s, confirmado leyendo `/var/ossec/ruleset/rules/0095-sshd_rules.xml` directo en el manager). Se habilitó `PasswordAuthentication yes` en la víctima — seguro porque `ubuntu` no tiene ninguna password real seteada, nadie puede entrar de verdad igual. Es la víctima dedicada al brute-force del propio PLAN.md, tiene sentido que acepte el ataque. |
| 2026-08-30 | `git checkout` a `unificacion-backend-frontend` (la branch de Lola, descartada el 24/08) seguido de un `git reset --hard origin/main` para "volver" | El reset borró silenciosamente todo el trabajo sin commitear de la sesión (rate limiting, `ruleDescription`, fecha en el detalle del incidente, `PLAN.md`/`README.md`) — un `checkout` a otra branch no avisa que un reset posterior va a descartar cambios sin commitear. Encima el HEAD quedó en un merge (`a9e35a4`) que había traído el backend paralelo de Lola sin la integración real de Wazuh, borrando `auth.js`/`db.js`/`normalize.js`/`wazuh.js`/tests de `orchestrator/src`. | Confirmado que `main` seguía intacto (el daño quedó contenido en la otra branch, nunca tocó `main`). Se volvió a `main` y se rehizo todo el trabajo perdido. Lección operativa: cualquier `git reset --hard` o cambio de branch en medio de una sesión hay que confirmarlo explícitamente antes de seguir — no asumir que "está todo igual" solo porque el directorio de trabajo parece el mismo. |
| 2026-08-30 | Adoptar tal cual las pantallas de la branch de Lola (`confirm.tsx`, `loading.tsx`, `success.tsx`, `incident.tsx`, `incidents.tsx`) para traer su rediseño visual | Todas tenían regresiones serias a datos mock: `loading.tsx` tenía un `MOCK_SUCCESS = true` literal que nunca llama al backend; `success.tsx` esperaba parámetros (`ip`/`target`/`time`) distintos a los que le manda nuestro `loading.tsx` real (`srcIp`/`hostname`/`elapsedMs`), con fallback hardcodeado `"1.4 seconds"`; `confirm.tsx` e `incidents.tsx` mostraban una IP/host fijos sin llamar a ninguna API; `incident.tsx` esperaba el incidente entero serializado en el parámetro de navegación (`params.incident`), no por `id`. | Se portó solo lo visual (el componente `BrandHeader`, la marca "Fortia") manteniendo intacta toda la lógica de datos real ya validada. Las pantallas de login/registro sí se adaptaron completas porque eran genuinamente mejores (validación de password, mostrar/ocultar) y no tenían este problema — salvo que el login pedía email en vez de username, corregido antes de adoptarlo. |
| 2026-08-30 | Login fallando con "Invalid credentials" en el celular pese a usar la password correcta | El mensaje era el mismo para *cualquier* error del `catch` — en realidad era un `429` (rate limit de `/auth/login` agotado en pruebas, 5 intentos/15min) mostrado con el texto de credenciales inválidas. | Ampliado el límite a 20 intentos/15min (sigue protegiendo contra fuerza bruta automatizada real, da margen para typos humanos) y diferenciado el mensaje de error en `index.tsx` según el status code (`429` vs `401` vs error de red) para que esto no vuelva a confundir. |
| 2026-08-30 | Después de resolver lo del rate limit, el login seguía pidiéndose dos veces: la primera "cargaba" y volvía sola a la pantalla de login; recién la segunda vez quedaba adentro | Confirmado con el audit log del server: **ambos** intentos de login llegaban bien al backend y devolvían un token válido — el problema no era el login en sí. La causa real: `SecureStore.setItemAsync` en Android no garantiza que una lectura inmediatamente posterior (`getItemAsync`) ya vea el valor escrito — el `GET /incidents` que dispara el dashboard apenas navega ahí llegaba sin token, el backend devolvía `401`, y el interceptor de `http.ts` interpretaba eso como sesión inválida y mandaba de vuelta al login. | `services/tokenStore.ts` ahora guarda el token también en una variable en memoria (no solo en `SecureStore`) — la lectura inmediata post-login usa la memoria (sin la latencia del keystore encriptado), `SecureStore` queda solo para sobrevivir a un reinicio de la app. |

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
| 2026-08-26 | `PasswordAuthentication yes` habilitado en la víctima, en contra del hardening por default de la AMI | El PLAN.md asume un atacante que hace fuerza bruta de passwords (hydra o loop de `ssh`) contra esta VM específicamente dedicada a ese rol — sin login por password, Wazuh nunca ve `Failed password` y la regla de brute-force no dispara. Queda así para la demo (no es un fix temporal a revertir). Ver tabla de errores para el detalle de por qué hacía falta. |
| 2026-08-30 | Se agregan modelos `User` y `AuditEvent` reales al backend (`GET/PUT /api/v1/me`, `GET /api/v1/audit`), en vez de dejar perfil/actividad como mock | Pedido explícito: "quiero que esté todo conectado, sin mocks". El perfil se resuelve con un `upsert` (no hace falta un endpoint de registro real, la fila se crea sola la primera vez que el usuario autenticado la pide) y el audit log se llena solo desde los puntos donde ya pasa algo real (login, incidente detectado, IP bloqueada). |
| 2026-08-30 | Se adopta la marca visual "Fortia" (`BrandHeader`, colores, `app.json`) de la branch de Lola en todas las pantallas, pero **no** su lógica de datos | Es el mismo criterio del 24/08 (no mergear la branch entera) aplicado pantalla por pantalla en vez de a la branch completa: lo visual se separa de lo funcional, y solo lo primero se adopta cuando lo segundo tiene regresiones a mock. |

---

## Bitácora de sesiones
_(La más reciente arriba. Formato fijo por entrada.)_

### Sesión 2026-08-30 — Incidente de branch, backend reconstruido, "sin mocks", deploy y fix de login
- **Objetivo de la sesión:** conectar todo lo que faltaba de la app a datos
  reales (perfil, actividad, dashboard) e incorporar el trabajo de UI de
  Lola con criterio, sin repetir el error de mergear su branch entera.
- **Hecho:**
  - **Incidente de git:** en medio de la sesión, el repo apareció parado en
    `unificacion-backend-frontend` (la branch descartada el 24/08) con un
    merge ya aplicado (`a9e35a4`) que había borrado `auth.js`, `db.js`,
    `normalize.js`, `wazuh.js` y los tests de `orchestrator/src`,
    reemplazándolos por el backend paralelo de Lola sin integración real de
    Wazuh. Causa: un `checkout` a esa branch seguido de un
    `git reset --hard origin/main` (del usuario, confirmado), que además
    descartó en silencio todo el trabajo sin commitear de esta misma sesión
    (rate limiting, `ruleDescription`, updates de `PLAN.md`/`README.md`).
    Confirmado que `main` nunca se tocó — el daño quedó contenido en la otra
    branch. Se volvió a `main` (con `git stash` de por medio para no perder
    nada) y se rehizo todo el trabajo perdido desde cero.
  - Backend: reconstruido rate limiting (`express-rate-limit`, `/auth/login`)
    y `ruleDescription`. Agregado de cero: modelo `User` +
    `GET/PUT /api/v1/me` (perfil real, se autocompleta con `upsert` la
    primera vez que se pide, sin necesitar un endpoint de registro real);
    modelo `AuditEvent` + `GET /api/v1/audit`, con registro automático en
    login exitoso, incidente detectado y IP bloqueada. 15/15 tests en verde
    (`tests/me.test.js`, `tests/audit.test.js` nuevos).
  - Frontend reconectado a datos reales: `dashboard.tsx` (ya usaba
    `getIncidents()`, se le sacaron las tarjetas inventadas "Assets"/
    "Status" sin dato real detrás, "Threat Level" ahora sale de la
    severidad máxima entre los incidentes abiertos), `profile.tsx`
    (`getStoredUser`/`updateUser` reales, edición de nombre/email
    funcional), `activity.tsx` (audit log real, reemplaza
    `data/activity.ts`). Borrados `data/activity.ts` y `data/user.ts` —
    no queda ningún mock de usuario/actividad en el repo.
  - Revisada pantalla por pantalla la branch de Lola (`git diff --stat`
    contra `main`, 29 archivos) para separar lo visual de lo funcional:
    - **Descartado sin tocar:** `AppMicroSOAR/terraform/` y
      `AppMicroSOAR/docs/` (copias duplicadas del `terraform/` y los `.md`
      reales de la raíz — traerlos generaría dos infraestructuras/
      documentaciones distintas), `app/biometric.tsx` (ya evaluado y
      descartado el 24/08).
    - **Adoptado completo:** `index.tsx` (login) y `register.tsx`
      (validación de password, mostrar/ocultar, marca "Fortia") — el login
      de Lola pedía email con validación de formato en vez de username, se
      adaptó antes de traerlo porque si no nadie podía loguearse con el
      usuario fijo real (`analyst`, no un email).
    - **Solo el header (`BrandHeader`), lógica intacta:** `confirm.tsx`,
      `loading.tsx`, `success.tsx`, `incident.tsx`, `incidents.tsx` — las
      cinco tenían regresiones serias a datos mock en la branch de Lola
      (`loading.tsx` con `MOCK_SUCCESS = true` literal, nunca llama al
      backend; `success.tsx` esperaba parámetros distintos a los que le
      manda nuestro `loading.tsx` real, con fallback hardcodeado
      `"1.4 seconds"`; `confirm.tsx`/`incidents.tsx` con IP y host fijos
      sin API; `incident.tsx` esperaba el incidente entero por parámetro de
      navegación en vez de buscarlo por `id`). Adoptarlas tal cual hubiera
      sido un retroceso a mock, exactamente lo que se estaba tratando de
      sacar.
    - **Chico y seguro:** `Header.tsx` (usa colores del tema), `colors.ts`
      (fondo ajustado), `app.json` (agrega `expo-font` y
      `expo-local-authentication` a los plugins — hace falta para que un
      build de EAS configure bien Face ID y la tipografía).
  - Deploy a AWS: instancias prendidas de nuevo, código nuevo empaquetado y
    desplegado al orchestrator (mismo patrón `tar`+`scp`, `.env` existente
    preservado), `npx prisma db push` remoto aplicó `User`/`AuditEvent` —
    la base quedó limpia de cero (no había `soar.db` viejo en el paquete).
    Confirmado en la instancia real: login, `GET /me`, `GET /audit` — los
    tres funcionan.
  - Bug post-deploy: el usuario no podía loguearse desde el celular,
    "Invalid credentials" pese a la password correcta. Diagnóstico por
    descarte (servidor probado directo por `curl`, funcionaba;
    conectividad Tailscale confirmada pidiendo la API desde el navegador
    del celular) hasta aislar la causa real: el rate limiter de
    `/auth/login` (5 intentos/15min) ya estaba agotado por las pruebas, y
    el `catch` de `index.tsx` mostraba el mismo texto genérico para
    cualquier error. Reiniciar el proceso resetea el contador (vive en
    memoria) — confirmado que eso lo resolvía. Ampliado a 20 intentos y
    diferenciado el mensaje de error (`429` vs `401` vs error de red) para
    que no vuelva a confundir, tanto en local como redeployado a AWS.
- **En progreso / a medias:** —
- **Errores encontrados:** ver tabla de arriba (el incidente de git, las
  regresiones a mock de la branch de Lola, el rate limit disfrazado de
  credenciales inválidas).
- **Próximo paso concreto:** actualizar `BITACORA_DESARROLLO.md` y
  `ARQUITECTURA_TECNICA.md` con lo de esta sesión (en curso). Después:
  video de respaldo y ensayo cronometrado — sigue siendo lo único que no se
  hizo todavía de cara al 1/9.
- **Estado de instancias AWS:** las 3 quedaron **running** al cierre de
  esta sesión (se prendieron para el deploy y las pruebas) — pararlas si no
  se sigue trabajando enseguida.

---

### Sesión 2026-08-26 — Webhook real de Wazuh conectado, primera detección automática end-to-end
- **Objetivo de la sesión:** cerrar el único pendiente real de la Fase 1 —
  que un brute-force SSH real cree el incidente solo, sin que alguien lo
  empuje a mano con `curl` (así venía quedando desde la sesión del 21/08).
- **Hecho:**
  - Detectado un hueco de arquitectura antes de tocar Wazuh: el security
    group del orchestrator no tenía **ninguna** regla para el puerto 8000,
    ni siquiera desde la VPC. El celular entra por Tailscale (no pasa por
    el SG), pero el manager de Wazuh no está en la tailnet — necesitaba una
    vía interna. Se agregó una regla de ingreso acotada al CIDR de la VPC
    (no a `0.0.0.0/0`, el puerto sigue sin estar expuesto a internet).
  - Esa regla, si se referenciaba por `security_groups` al SG de Wazuh,
    generaba un ciclo de dependencias con la regla ya existente en sentido
    inverso (puerto 55000). Resuelto usando el CIDR de la VPC en vez de la
    referencia cruzada (ver tabla de errores).
  - **Casi se pierde todo el trabajo del 21/08:** al aplicar ese cambio de
    security group con las 3 instancias `stopped`, el plan de Terraform
    mostraba que iba a **reemplazar las 3 instancias** por un falso
    positivo de `associate_public_ip_address` (ver tabla de errores).
    Detectado antes de aplicar. Fix permanente con `lifecycle` en las 3
    instancias — sin esto, iba a volver a pasar cada vez que se tocara
    Terraform con las instancias paradas.
  - Aplicado sin destruir nada (`0 destroyed`), instancias prendidas de
    nuevo. Confirmado que `pm2` resucitó solo (valida el `pm2 startup` de
    la sesión anterior) y que Wazuh manager + agente volvieron activos tras
    el `stop`/`start`.
  - `integrations/custom-microsoar` + `.py` desplegados al manager
    (`root:wazuh`, `750`, mismo patrón que las integraciones oficiales ya
    instaladas). Primer intento falló por CRLF en los archivos (ver tabla
    de errores) — corregido en el repo, agregado `.gitattributes` para que
    no vuelva a pasar, redesplegado.
  - Bloque `<integration>` agregado a `ossec.conf` (con backup del archivo
    original antes de tocarlo), apuntando al orchestrator por su IP
    **privada**. `wazuh-manager` reiniciado, `ossec.log` confirma
    `Enabling integration for: 'custom-microsoar'`.
  - Primer intento de brute-force (loop de `ssh` sin password) no disparó
    la regla de Wazuh — diagnosticado leyendo el ruleset real del manager
    (`0095-sshd_rules.xml`): la regla `5712` necesita `Failed password`,
    no `Invalid user`, y la víctima tenía `PasswordAuthentication no` por
    default de la AMI. Habilitado a propósito (ver tabla de decisiones —
    es la víctima dedicada al ataque, y sigue sin tener ninguna password
    real, nadie entra de verdad).
  - **Brute-force real corrido por el usuario** (loop de `ssh` en
    PowerShell contra la víctima) → regla `5712` (nivel 10) disparó →
    `custom-microsoar` posteó al webhook → el incidente apareció en
    `GET /incidents` **sin ninguna intervención manual**. Confirmado
    leyendo la lista completa: `id:2`, `ruleId:"5712"`, `srcIp` real del
    atacante, timestamp exacto del ataque. **Cierra la Fase 1.**
  - Nota para el guion de la demo real: el mismo ataque de prueba disparó
    también la regla `40112` (nivel 12) porque el "atacante" y el "admin"
    fueron la misma laptop/IP en esta sesión — Wazuh correlaciona
    brute-force seguido de un login exitoso desde la misma IP como
    sospechoso. Para la demo real, atacante y analista deberían ser
    máquinas/IPs distintas, como ya prevé el PLAN.md, para no generar
    ruido extra.
- **En progreso / a medias:** ajustes de UI que el usuario dejó pendientes
  de la sesión anterior, todavía sin detallar.
- **Errores encontrados:** ver tabla de arriba (ciclo de SG,
  `associate_public_ip_address`, CRLF en los scripts de integración,
  `PasswordAuthentication` de la víctima).
- **Próximo paso concreto:** ajustes de UI pendientes; después, video de
  respaldo y ensayo cronometrado. `PLAN.md` sigue sin actualizar la fecha
  de deadline (18/08 → 1/9).
- **Estado de instancias AWS:** las 3 quedaron **stopped** al cierre de
  esta sesión (se habían prendido para esta prueba y luego se frenaron)

---

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