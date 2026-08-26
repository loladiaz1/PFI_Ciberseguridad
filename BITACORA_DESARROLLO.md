# Bitácora de Desarrollo — Micro-SOAR

> Registro narrativo del desarrollo: decisiones técnicas, problemas
> encontrados y cómo se resolvieron. Pensado como material de respaldo para
> la defensa del PFI — explica el *por qué*, no solo el *qué*.
>
> Complementa a [`progress.md`](progress.md), que es el diario de trabajo
> crudo (append-only, formato de tabla). Acá el contenido se organiza por
> entrada temática, con más contexto y justificación técnica.

---

## Entrada 4 — 2026-08-26: Se conecta el webhook real de Wazuh — primera detección automática de punta a punta

### Contexto

Con la infraestructura recuperada (Entrada 3), el flujo completo funcionaba
salvo por un detalle que no era cosmético: el incidente que veía la app
llegaba porque alguien lo empujaba a mano con `curl` contra el webhook, no
porque Wazuh lo detectara solo. Esa es exactamente la premisa que el
proyecto tiene que demostrar — "Wazuh detecta → aparece en el celular" — así
que cerrar esto no era una tarea más, era la última pieza real de la Fase 1.

### Un hueco de arquitectura que nadie había notado

Antes de tocar la configuración de Wazuh, hizo falta resolver algo previo:
el security group del orchestrator no tenía ninguna regla que permitiera el
puerto 8000, ni siquiera desde dentro de la VPC. Esto no se había notado
antes porque el único cliente probado hasta ese momento era el celular, que
entra por Tailscale — un túnel que no pasa por las reglas del security group
en absoluto. El manager de Wazuh, en cambio, no está en la tailnet (solo el
celular y el orchestrator lo están) y necesita una vía de red normal para
poder invocar el webhook.

La solución más simple —replicar el patrón que ya existía para la llamada
inversa (el orchestrator hacia la API de Wazuh, puerto 55000, permitida por
referencia al security group de Wazuh)— chocó con un problema de Terraform:
referenciar el security group de Wazuh desde el del orchestrator, cuando el
de Wazuh ya referenciaba al del orchestrator en sentido inverso, generaba un
ciclo de dependencias irresoluble (ambos usan bloques `ingress` inline
dentro del propio recurso, así que ninguno de los dos puede crearse sin que
el otro ya exista). Convertir esa regla puntual a un recurso
`aws_security_group_rule` independiente habría evitado el ciclo, pero
reintroducía un bug ya conocido de una sesión anterior: Terraform trata un
bloque `ingress` inline como la lista completa y autoritativa de reglas de
ese security group, así que una regla standalone sobre el mismo SG se
autodestruye en cada `apply`. La solución final fue más simple de lo
esperado: usar el CIDR de la VPC en vez de una referencia cruzada entre
security groups. Sigue sin haber ninguna regla que exponga el puerto 8000 a
internet — el pitch de acceso Zero Trust del celular no se toca — solo se
habilita tráfico interno entre instancias de la misma VPC.

### Un `terraform apply` que casi destruye todo lo recuperado

Este es el hallazgo más serio de la sesión, no por la solución (fue
trivial) sino por lo cerca que estuvo de pasar desapercibido. Al correr
`terraform plan` para aplicar el cambio de security group de arriba, con las
tres instancias `stopped` (el hábito de apagarlas para no gastar), el plan
mostraba que iba a **reemplazar las tres instancias** — no solo cambiar el
security group. La causa: `associate_public_ip_address` es un atributo que
únicamente tiene efecto al lanzar una instancia, pero la API de AWS lo
reporta según el estado *actual* de la instancia — y una instancia parada,
en ese momento, no tiene ninguna IP pública asociada, así que la API
devuelve `false`. Terraform compara eso contra el `true` declarado en el
código y, como es un atributo que no se puede modificar in-place, concluye
que hace falta destruir y recrear la instancia para "corregir" una
diferencia que en realidad nunca existió.

De haberse aplicado sin revisar el detalle del plan, se habría perdido en
un solo comando todo lo logrado en la Entrada 3: la identidad de Tailscale
del orchestrator, el código ya deployado, el agente enrolado de la víctima.
La solución es un `lifecycle { ignore_changes = [associate_public_ip_address] }`
en las tres instancias — no es un parche para esta vez puntual, es una
corrección permanente, porque el equipo tiene el hábito (correcto, para no
gastar crédito de AWS) de parar las instancias entre sesiones, y este falso
positivo iba a reaparecer cada vez que se tocara Terraform con la
infraestructura apagada.

### Los scripts de integración no se ejecutaban, y el error no decía por qué

Con el security group resuelto, se copiaron los dos archivos de la
integración (`custom-microsoar`, el wrapper, y `custom-microsoar.py`, la
lógica real) al manager, replicando el mismo esquema de permisos que ya
usan las integraciones oficiales de Wazuh (`root:wazuh`, `750`). El manager
los rechazaba con un error genérico: *"Couldn't execute command (...). Check
file and permissions."* — un mensaje que sugiere un problema de permisos,
pero los permisos eran correctos.

La causa real apareció con `cat -A` sobre el archivo: los finales de línea
eran CRLF, no LF — un rastro de que el archivo se había creado o editado en
algún momento sobre Windows. El shebang de la primera línea quedaba
literalmente `#!/bin/sh\r`: un intérprete con un retorno de carro pegado al
final, que evidentemente no existe en el sistema de archivos. El kernel no
podía resolver ese intérprete al hacer `exec()`, y Wazuh solo veía el fallo
genérico del sistema, sin visibilidad de la causa real. Corregido
convirtiendo ambos archivos a LF, y agregado un `.gitattributes` que fuerza
`eol=lf` para los scripts de integración y cualquier `.sh` del repo — sin
esto, el mismo problema iba a reaparecer la próxima vez que alguien hiciera
un checkout del repo en Windows con la configuración por defecto de git.

### El primer ataque de prueba no disparó nada, y eso también tenía una causa concreta

Con la integración ya ejecutándose correctamente (confirmado con una
llamada de prueba que llegó a devolver un `422` real del orchestrator —
prueba de que la conexión de red y la ejecución del script ya funcionaban
de punta a punta), se probó con una fuerza bruta real: un loop de intentos
de `ssh` contra la víctima. La app nunca mostró el incidente.

En vez de asumir una causa, se leyó directamente el ruleset de Wazuh en el
manager (`/var/ossec/ruleset/rules/0095-sshd_rules.xml`). La regla `5712`
("brute force trying to get access to the system") requiere `frequency=8`
de la regla `5710` en una ventana de 120 segundos, sobre la misma IP de
origen — y `5710` matchea específicamente líneas de `Failed password` o
`invalid user`, generadas por sshd solo cuando efectivamente se intenta una
autenticación por password. La víctima, como toda AMI oficial de Ubuntu,
trae `PasswordAuthentication no` por defecto (hardening estándar) — el
intento de conexión se cerraba en preauth sin que sshd llegara a loguear un
intento de password.

Habilitar `PasswordAuthentication yes` en esa instancia puntual no es un
retroceso de seguridad real: el usuario `ubuntu` no tiene ninguna password
configurada (viene bloqueado por defecto), así que habilitar el método de
autenticación no abre ninguna puerta que no estuviera ya cerrada por la
ausencia de credenciales válidas — solo hace que sshd genere el log que
Wazuh necesita para detectar el patrón. Es, además, exactamente el
comportamiento que el propio `PLAN.md` da por sentado: esta VM es la
víctima dedicada del brute-force de la demo, con un atacante real
(`hydra` o un loop de `ssh`) probando passwords contra ella.

### Resultado

Con el password habilitado, un brute-force real disparó la regla `5712`,
la integración posteó al webhook, y el incidente apareció en
`GET /api/v1/incidents` sin que nadie lo tocara a mano — confirmado
leyendo la fila completa: `ruleId: "5712"`, la IP real del atacante, el
timestamp exacto del ataque. Es la primera vez que el hilo dorado completo
del `PLAN.md` corre de punta a punta con los tres actores reales operando
solos: Wazuh detecta, el orquestador normaliza, la app lo puede mostrar —
sin ningún paso manual en el medio. Cierra la Fase 1 del plan de trabajo.

De paso, la misma prueba dejó un dato útil para el guion de la demo real:
la regla `40112` (nivel 12, más alta que la propia `5712`) también disparó,
porque el "atacante" de la prueba y el acceso administrativo por SSH usado
para diagnosticar salieron de la misma laptop — Wazuh correlaciona un
brute-force seguido de un login exitoso desde la misma IP como un patrón
más sospechoso todavía. No es un bug: es la razón concreta por la que, en
la demo real, el atacante tiene que ser una máquina distinta de la del
analista, tal como ya lo plantea el `PLAN.md`.

### Próximo paso

Ajustes de UI pendientes, video de respaldo y ensayo cronometrado del guion
completo antes del 1 de septiembre.

---

## Entrada 3 — 2026-08-21: Recuperar la infraestructura desde cero y primera validación end-to-end real desde un celular

### Contexto

Entre la Entrada 2 y esta hubo un vacío de casi dos semanas sin commits de
código. Al retomar, con el deadline de la demo ya movido al 1 de
septiembre, la primera pregunta no fue "¿qué falta construir?" sino "¿qué
de lo que ya está construido funciona de verdad?" — porque en el medio se
había hecho una migración completa del backend, se había terminado toda la
app, y se había agregado una instancia de Terraform dedicada al
orchestrator con Tailscale, pero nada de eso se había probado nunca contra
infraestructura real.

La respuesta apareció rápido y fue contundente: `terraform.tfstate` estaba
vacío. Se había corrido un `destroy` en algún momento, y absolutamente todo
lo construido después de esa fecha —el código del orchestrator, la app
terminada, la propia definición de Terraform del orchestrator— nunca había
llegado a correr contra un Wazuh real. El trabajo de esta sesión fue, en los
hechos, repetir el spike original (Entrada 1) pero contra una arquitectura
mucho más grande, y encontrar todo lo que se había roto en el camino sin que
nadie lo supiera.

### Un placeholder de la documentación tratado como una URL real

El primer `terraform apply` no instaló Wazuh: `cloud-init` terminaba en
estado de error. La causa fue un bug real en el script de arranque del
manager, no un problema de infraestructura: la línea que descarga el
instalador usaba `https://packages.wazuh.com/4.x/wazuh-install.sh`, donde
`4.x` es un placeholder que la documentación oficial de Wazuh usa para
referirse a la serie de versiones, nunca reemplazado por una versión
concreta. Esa URL devuelve un XML de error de Amazon S3 ("Access Denied"),
que el script interpretaba como si fuera el propio instalador —
`./wazuh-install.sh: line 1: syntax error near unexpected token`. Corregido
fijando la versión real (`4.8`, la misma que ya estaba pineada para el
agente desde la Entrada 1, para no reabrir el problema de incompatibilidad
de versiones ya resuelto en su momento).

Corregir el script no alcanzó por sí solo: un `terraform apply` normal
después del fix mostraba "update in-place" en el plan, no una recreación —
este proveedor de AWS no vuelve a ejecutar el `user_data` de una instancia
que ya existe cuando el contenido cambia, solo actualiza el valor guardado
en el estado. Hizo falta forzar la recreación explícita con
`terraform apply -replace` tanto para el manager como para la víctima (la
víctima también necesitaba rebootear, porque su propio `user_data`
interpola la IP privada del manager, que cambia al recrearlo).

### Reconstruir el resto de la cadena, un eslabón a la vez

Con el manager arriba, cada pieza siguiente reveló su propio problema
puntual: Tailscale había quedado pendiente de activación manual porque el
`authkey` se había agregado a la configuración después de que la instancia
ya había arrancado (se resolvió con un `tailscale up` manual por SSH, sin
necesidad de recrear la instancia); el archivo `.env` de la app tenía la
URL de la API duplicada, y como `dotenv` toma la primera ocurrencia y no la
última, la app hubiera seguido usando `localhost` en silencio aunque la
línea correcta estuviera más abajo; y el deploy del código del orchestrator
a su instancia tuvo que resolverse con `tar` + `scp` en vez de `rsync`,
porque esa herramienta no está disponible ni en PowerShell ni en Git Bash
en Windows.

Un hallazgo más sutil apareció al limpiar la base de datos SQLite que había
viajado sin querer dentro del paquete del deploy, con datos de pruebas
locales viejas: Prisma resuelve la ruta `file:./soar.db` (definida en
`DATABASE_URL`) en relación a la carpeta donde vive `schema.prisma`, no a
la raíz del proyecto. Los primeros intentos de borrar la base fallaban en
silencio porque apuntaban a un archivo que no era el real.

### Primera prueba real desde un dispositivo físico

Con toda la cadena reconstruida, se corrió por primera vez el flujo
completo desde un celular real, no desde un script: login, lista de
incidentes, detalle, autenticación biométrica de verdad (no un mock),
confirmación, y bloqueo — con el resultado confirmado en el firewall real
de la víctima (`iptables -L -n` mostrando el `DROP`). Es la primera vez que
el hilo dorado del `PLAN.md` corre de punta a punta desde un dispositivo
físico contra la arquitectura completa (Tailscale, la instancia dedicada
del orchestrator, todo).

Esa misma prueba dejó al descubierto un problema de experiencia de usuario
que nadie había notado porque nunca se había navegado la app de verdad
contra datos reales: cambiar de pestaña se sentía como si recargara toda la
aplicación. La causa era estructural: la navegación inferior (`BottomNav`)
usaba `router.push()` sobre un `Stack` de expo-router, no sobre un `Tabs` —
cada toque apilaba una pantalla nueva en vez de cambiar entre pestañas ya
montadas, así que cada cambio de pestaña remontaba la pantalla entera y
volvía a pedir los datos a la API desde cero. La solución fue mover las
cuatro pantallas de pestañas a un grupo `app/(tabs)/` con un `Tabs` real,
manteniendo el diseño visual existente a través de un componente de barra
de pestañas custom que usa `navigation.navigate()` en vez de `router.push()`
— cambiar de pestaña pasó a ser instantáneo, sin recargar nada.

### Resultado

Al cierre de la sesión, la arquitectura completa (Wazuh, víctima,
orchestrator en AWS, Tailscale, la app) estaba reconstruida, deployada, y
validada de punta a punta desde un dispositivo real — con la única
salvedad de que el incidente todavía se inyectaba a mano contra el webhook,
en lugar de llegar solo desde una alerta real de Wazuh (resuelto en la
Entrada 4).

### Próximo paso

Conectar el webhook real de Wazuh (`ossec.conf` + la integración custom),
para que un brute-force real dispare todo el flujo sin intervención manual.

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
