# Bitácora de Desarrollo — Micro-SOAR

> Registro narrativo del desarrollo: decisiones técnicas, problemas
> encontrados y cómo se resolvieron. Pensado como material de respaldo para
> la defensa del PFI — explica el *por qué*, no solo el *qué*.
>
> Complementa a [`progress.md`](progress.md), que es el diario de trabajo
> crudo (append-only, formato de tabla). Acá el contenido se organiza por
> entrada temática, con más contexto y justificación técnica.

---

## Entrada 2 — 2026-08-04: Migración del orchestrator a Node.js/Express

La Entrada 1 describe el backend inicial construido en Python/FastAPI: se
eligió por ser la forma más corta y directa de resolver el spike de la
Fase 0 (autenticación HTTP, un token, una llamada PUT), y esa elección se
extendió naturalmente al resto del orchestrator (webhook, normalización,
persistencia) por consistencia.

Ese backend funcionaba correctamente — la Fase 0 ya estaba validada contra
infraestructura real (ver Entrada 1) y la Fase 1 tenía tests en verde. Sin
embargo, el documento de propuesta del PFI, ya entregado y evaluado
formalmente, especifica un stack concreto para el backend/orquestación:
Node.js v18+, Express, Axios, autenticación JWT, PostgreSQL y Redis. Python
no figuraba como opción.

Esto plantea una distinción importante: no es un error técnico a corregir,
sino una restricción externa (el compromiso ya asumido con el documento
entregado) que prevalece sobre la preferencia de simplicidad que motivó la
elección original. Frente a esa restricción, la decisión fue migrar el
orchestrator completo a Node.js antes de seguir construyendo funcionalidad
nueva sobre una base que iba a tener que reescribirse de todos modos —
cuanto antes se hiciera el cambio, menos código había que traducir.

### Qué se preservó en la migración

La migración fue una traducción de stack, no un rediseño: la arquitectura,
los endpoints, el modelo de datos y la lógica de normalización se
mantuvieron idénticos.

- **Express** reemplaza a FastAPI para el webhook y el listado de
  incidentes.
- **Prisma** reemplaza a SQLAlchemy como capa de acceso a datos, con el
  mismo criterio: SQLite en desarrollo local, migrar a PostgreSQL más
  adelante es cambiar el `provider` del schema y la variable
  `DATABASE_URL`, no reescribir código.
- **Axios** reemplaza a `requests` en `block_ip.js`, conservando el mismo
  flujo de autenticación (Basic Auth → JWT) y la misma corrección aplicada
  en la Entrada 1 (la IP va en `alert.data.srcip`, no en `arguments`).
- **Jest + Supertest** reemplazan a `pytest`, con la misma cobertura de
  casos (alerta válida, alerta con campos faltantes, listado).

Los tres tests pasaron en la primera corrida contra el nuevo stack, lo cual
confirma que la migración no introdujo regresiones: la lógica de negocio
(normalización de alertas, validación, persistencia) es la misma, solo
cambió el lenguaje y las librerías que la expresan.

### Redis y PostgreSQL

El documento de propuesta menciona también PostgreSQL y Redis. PostgreSQL
ya estaba contemplado desde el diseño original (no depende del lenguaje);
Redis quedó deliberadamente fuera del alcance de la demo de 5 minutos
(documentado en `PLAN.md`, sección "Fuera del MVP") porque no hay un caso
de uso que lo requiera en el flujo mínimo que se muestra — se deja anotado
como trabajo futuro ("se activa al escalar"), no como una omisión.

---

## Entrada 1 — 2026-08-04: Backend inicial y validación del bloqueo automatizado

### Contexto

El proyecto plantea bajar el tiempo de contención de un ataque de fuerza
bruta SSH mediante un flujo automatizado: Wazuh detecta → un orquestador
normaliza el incidente → una acción de bloqueo se ejecuta contra el
atacante en segundos, en vez de los 8–14 minutos que toma el proceso manual
tradicional (VPN + consola).

De todo ese flujo, un solo paso concentraba la incertidumbre técnica real:
¿la API de Wazuh permite disparar un bloqueo de IP de forma programática,
sin intervención humana en la consola? Si la respuesta era no, todo el
proyecto necesitaba un plan B (por ejemplo, ejecutar el bloqueo por SSH en
vez de por API). Por eso este paso —llamado el "eslabón crítico" en el plan
de trabajo— se abordó primero, antes de construir cualquier otra pieza.

### Infraestructura (Terraform)

La infraestructura se define en Terraform sobre AWS: una instancia para el
manager de Wazuh y, según fue necesario durante el spike, una segunda
instancia dedicada a jugar el rol de víctima del ataque.

La decisión de usar una instancia separada para la víctima (en vez de
instalar el agente de Wazuh en la propia instancia del manager) surgió a
mitad del spike, cuando se descubrió que Wazuh rechaza explícitamente
cualquier acción de respuesta activa dirigida al agente `000` (que
representa al manager mismo). Se evaluó la alternativa de instalar el
agente localmente sobre el manager, pero separar atacante → víctima →
manager en máquinas distintas resultó más representativo de un despliegue
real y no implicó costo adicional relevante (la instancia víctima es una
`t3.micro`, elegida deliberadamente barata porque solo necesita correr
`sshd` y el agente de Wazuh).

### El backend del orquestador (FastAPI)

En paralelo a la infraestructura, se construyó el esqueleto del backend
(`orchestrator/`) que va a recibir las alertas de Wazuh:

- Un endpoint `POST /api/v1/webhook/wazuh` que recibe la alerta cruda.
- Una capa de normalización que traduce el formato específico de Wazuh a un
  modelo `Incident` propio y estable — para que el resto del sistema (la
  app, la lógica de negocio) no dependa del formato de un proveedor externo.
- Persistencia del incidente (SQLite en desarrollo local; migrar a
  PostgreSQL más adelante es un cambio de una sola variable de entorno,
  gracias a usar SQLAlchemy).
- Un endpoint `GET /api/v1/incidents` para listar lo persistido.

Como todavía no había un Wazuh real enviando alertas, se armó un JSON de
muestra con una alerta típica de fuerza bruta SSH, y se escribieron tests
automatizados que validan el flujo completo (recepción → normalización →
persistencia) contra ese mock. Esto permitió desarrollar y verificar la
lógica de negocio sin bloquearse esperando la infraestructura.

### El spike: bloqueo real vía API de Wazuh

El script `orchestrator/block_ip.py` implementa el flujo mínimo necesario:
autenticarse contra la API de Wazuh con Basic Auth para obtener un token
JWT, y usar ese token para invocar `PUT /active-response` con el comando
`firewall-drop` sobre un agente.

Validar este flujo terminó exigiendo resolver, en secuencia, cinco
problemas concretos — cada uno con una causa distinta, y cada uno relevante
para entender qué tan sólido es el mecanismo subyacente:

**1. El agente `000` rechaza respuestas activas.**
El primer intento apuntó al agente `000` (el manager) porque parecía el
objetivo natural antes de tener un agente separado. La API respondió con
HTTP 200 pero un código de error interno (1703, "Action not available for
Manager"), dejando claro que Wazuh reserva ese agente para sí mismo y que
hace falta un agente real registrado como objetivo. Esto fue lo que motivó
la decisión de infraestructura descripta arriba.

**2. `sudo` pedía una contraseña que no existe.**
Las AMI oficiales de Ubuntu configuran al usuario `ubuntu` con sudo sin
contraseña por defecto (vía `cloud-init`). En una de las instancias, por una
causa no del todo confirmada, esa configuración no quedó aplicada, dejando
la instancia sin acceso administrativo real (no hay ninguna contraseña
válida para ese usuario). La solución fue dejar de depender del
comportamiento por defecto de `cloud-init` y forzar explícitamente el
`NOPASSWD` desde el propio script de arranque (`user_data`) de cada
instancia.

**3. Una regla de firewall que se creaba y desaparecía sola.**
Para que el agente de la víctima pudiera inscribirse contra el manager,
hacía falta abrir los puertos 1514/1515 en el security group de Wazuh. La
regla se agregó como un recurso Terraform independiente
(`aws_security_group_rule`), pero el security group del manager ya definía
sus reglas de forma inline dentro de su propio recurso. Terraform trata ese
bloque inline como la lista completa y autoritativa de reglas, así que en
cada `apply` eliminaba silenciosamente la regla agregada por fuera. La
solución fue unificar todo bajo el mismo estilo (reglas inline), eliminando
el recurso separado.

**4. Incompatibilidad de versiones entre agente y manager.**
Una vez resuelta la conectividad, el agente lograba contactar al manager
pero el registro era rechazado (`Incompatible version for new agent`): el
paquete del agente, instalado sin fijar versión, había traído la última
versión disponible del repositorio (4.14.7), mientras que el instalador
`wazuh-install.sh` había dejado el manager en una versión distinta (4.8.2).
Wazuh exige coincidencia de versión entre agente y manager para aceptar el
registro. La solución fue fijar explícitamente la versión del paquete del
agente para que coincida con la del manager.

**5. El comando de bloqueo se aceptaba pero no bloqueaba nada.**
Con el agente ya registrado y activo, la API devolvía éxito (`error: 0`,
sin `failed_items`) al invocar `firewall-drop`, pero no aparecía ninguna
regla nueva en `iptables` de la víctima. El log del agente reveló la causa:
el script `firewall-drop` no lee la IP objetivo del campo `arguments` de la
solicitud, sino de `alert.data.srcip` — el mismo campo que ya se usa para
extraer la IP de una alerta real de Wazuh. Ajustar el payload enviado por
`block_ip.py` resolvió el problema.

### Resultado

Con los cinco problemas resueltos, se confirmó el bloqueo real ejecutando
`sudo iptables -L -n` en la instancia víctima: apareció la regla `DROP`
para la IP de prueba (8.8.8.8). El flujo completo —autenticación, token,
comando de respuesta activa, y bloqueo efectivo a nivel de firewall— quedó
probado de punta a punta contra infraestructura real, no simulada.

Esto valida la premisa técnica central del proyecto: es posible orquestar
un bloqueo de IP sobre Wazuh de forma completamente programática, sin
intervención manual en su consola. El resto de la arquitectura (webhook,
app móvil, step-up auth) puede construirse con la confianza de que el paso
que más incertidumbre presentaba —y que hubiera obligado a un cambio de
enfoque significativo si hubiera fallado— efectivamente funciona.

### Próximo paso

Conectar el webhook del orquestador a una alerta real de Wazuh (en vez del
JSON de muestra usado hasta ahora), cerrando así el resto de la Fase 1 del
plan de trabajo.
