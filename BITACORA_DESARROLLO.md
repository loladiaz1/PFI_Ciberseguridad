# Bitácora de Desarrollo — Micro-SOAR

> Registro narrativo del desarrollo: decisiones técnicas, problemas
> encontrados y cómo se resolvieron. Pensado como material de respaldo para
> la defensa del PFI — explica el *por qué*, no solo el *qué*.
>
> Complementa a [`progress.md`](progress.md), que es el diario de trabajo
> crudo (append-only, formato de tabla). Acá el contenido se organiza por
> entrada temática, con más contexto y justificación técnica.

---

## Entrada 12 — 2026-10-18: Medir, encontrar el límite y ajustar el diseño

### Contexto

Con los tres casos de uso implementados, faltaban dos mediciones para las
Conclusiones: cuánto tarda la contención cuando la decide la automatización
(en lugar del analista) y cuánto tarda la contención de CU-03, que todavía no
se había medido. La sesión siguió el mismo ciclo que ya había dado resultado
el 14/10 (la campaña de medición que llevó a agrupar alertas y a diseñar la
automatización): **medir contra la infraestructura real, leer los números,
y cambiar el diseño donde no alcanzan**.

### La contención automática

Se repitió el método de la campaña del 14/10 (fuerza bruta SSH y archivo
EICAR contra la víctima), pero con la automatización en modo activo: tres
corridas por caso de uso, ninguna intervención humana. Para medir se habilitó
una política de laboratorio sin la condición de reputación (la de producción
exige que AbuseIPDB califique la IP con 80 o más, y la del laboratorio no la
tiene) y se subió el cortacircuitos para que no interrumpiera la serie; todo
por la API de administración, auditado, y restaurado al terminar.

Las seis corridas se contuvieron solas: contención p50 **1,51 s** y p95
**1,96 s**, contra 21,1 s y 31,3 s de la contención manual. La diferencia es
exactamente la que la campaña del 14/10 había anticipado: la decisión del
analista era el 94 % del tiempo; decidida por una política, tarda 0,25 s. Un
detalle que aparece solo midiendo: la primera corrida de fuerza bruta tardó
0,83 s en decidir y las siguientes 0,25 s, porque la política se evalúa
después de consultar la reputación de la IP y las corridas siguientes usaron
la caché. Un atacante nuevo paga ese costo.

### CU-03: la medición encuentra un límite

Cinco corridas de CU-03 con contención manual: llega la campaña, el usuario
la reporta, el analista pone el correo en cuarentena desde el celular. La
contención total (p50 25,4 s) es del mismo orden que la de los otros casos y
cumple la cota de 60 s. La acción es la más rápida de los tres casos (0,10 s
para mover los correos en los dos buzones). Pero la **detección** dio p50
6,8 s y p95 11,8 s: no cumple la cota de 5 s del RNF-05 en tres de cinco
corridas.

La causa estaba en el diseño, no en la infraestructura: el orquestador
revisaba el buzón de reportes cada 15 segundos, así que un reporte podía
esperar hasta 15 segundos antes de existir como incidente. Las cotas se
habían definido con CU-01 y CU-02, donde la alerta la empuja Wazuh en el
momento.

### La decisión: cambiar el diseño, no el requerimiento

Había dos salidas. Acotar el RNF-05 a las alertas de Wazuh y definir una cota
más laxa para el correo era rápido, pero era aceptar el número en vez de
mejorarlo. La otra era que el orquestador se enterara del reporte en el
momento, igual que con Wazuh. IMAP tiene un mecanismo estándar para eso,
**IDLE**: el cliente deja una conexión abierta sobre la carpeta y el servidor
avisa apenas llega un correo. La librería que ya se usaba lo soporta, así que
el cambio quedó contenido en el único archivo que conoce IMAP
(`mailProvider.js`), coherente con el diseño que aísla al proveedor de correo
(en Microsoft Graph o Gmail, el equivalente son las suscripciones).

Dos detalles del diseño: la conexión puede caerse, así que reconecta con una
espera creciente (de 1 segundo a 1 minuto) y, al reconectar, lee por las
dudas lo que haya llegado mientras tanto; y el chequeo periódico no
desaparece, queda como red de seguridad cada 60 segundos. Si un aviso llega
mientras se está leyendo el buzón, se vuelve a leer al terminar: no se pierde.

### Una revisión que encuentra un error de infraestructura

Al pasar los diagramas de la tesis a formato vectorial, el diagrama de
arquitectura se dibujó a partir de los security groups reales de Terraform.
Ahí apareció que el manager de Wazuh solo aceptaba conexiones de agentes
desde la víctima: el agente del servidor de correo, instalado en la sesión
anterior, nunca había podido registrarse. No afectaba a CU-03, pero sí a la
evolución prevista (los logs del antispam llegan por ese agente). Se corrigió
agregando el grupo del servidor de correo a la regla.

### Volver a medir

Con el cambio desplegado se repitieron las cinco corridas de CU-03. La
detección bajó de 6,8 s a 0,84 s de mediana y de 11,8 s a 1,29 s en el peor
caso: las cinco corridas cumplen la cota que antes fallaba, y CU-03 quedó en
el mismo orden que los casos que reciben la alerta de Wazuh. La contención
total también bajó a la mitad, pero solo una parte se explica por el cambio:
la decisión del analista fue más rápida porque era la misma persona
repitiendo el mismo flujo, y eso se registró como tal en lugar de
atribuírselo al diseño.

### Resultado

- Contención automática medida y documentada: p50 1,51 s, p95 1,96 s.
- CU-03: la medición encontró una detección fuera de la cota (p50 6,8 s); el
  diseño cambió a IMAP IDLE (210 tests) y la nueva medición cumple
  (p50 0,84 s, p95 1,29 s). El ciclo medir → encontrar → ajustar → volver a
  medir quedó completo y con datos.

---

## Entrada 11 — 2026-10-17: CU-03, el tercer caso de uso, y una campaña en vez de un correo

### Contexto

La propuesta comprometía tres pruebas de concepto: fuerza bruta (CU-01),
equipo infectado (CU-02) y correo malicioso (CU-03). La tercera era la que
tenía más distancia entre lo comprometido y lo construido: no existía ningún
componente de correo en la infraestructura.

### Un servidor de correo de laboratorio

Se descartó integrar Gmail o Microsoft 365 para el prototipo: dependen de
cuentas externas, de tokens que vencen y de permisos de administrador de un
dominio. En su lugar se agregó una instancia propia con Postfix y Dovecot,
creada desde Terraform como el resto, en un dominio ficticio y sin exponer el
puerto de correo a internet. El orquestador entra a los buzones con un
usuario maestro que el servidor solo acepta desde su IP, el equivalente de
laboratorio del permiso de lectura y escritura de correo de Microsoft Graph.
Toda la integración vive en un único archivo, así que migrar a un proveedor
real es reescribir ese archivo.

### El reporte del usuario y la campaña

El usuario reenvía el correo sospechoso como adjunto al buzón de reportes,
igual que los botones de "reportar phishing" de Outlook y Gmail; así se
conserva el identificador del mensaje (Message-ID), que es la clave para
encontrarlo en todos los buzones. El incidente no es un correo sino una
**campaña**: se agrupan los reportes del mismo mensaje y, después, los de
variantes con otro asunto o remitente que comparten un indicador fuerte (el
mismo adjunto, el mismo dominio de enlace, la misma dirección de respuesta).
A partir de esos indicadores, el sistema busca en los buzones otros correos
de la campaña y los propone como candidatos; la cuarentena de esos la decide
siempre un analista, porque un error ahí saca correo legítimo de varias
personas.

### Escala

Se analizó qué pasaría con una campaña de miles de correos. Dos ajustes se
hicieron en el momento (la cuarentena abre una conexión por buzón para toda
la campaña, y los reportes de variantes se suman a la campaña abierta); el
resto (un índice de mensajes en lugar de recorrer buzones, cuarentena en
segundo plano, candidatos agrupados por variante, límite de impacto) quedó
como trabajo futuro, junto con un antispam (Rspamd) como segunda fuente de
detección.

### Resultado

CU-03 probado contra la infraestructura real: campaña con dos variantes y un
correo legítimo; la búsqueda encontró las dos variantes y dejó afuera el
legítimo; la cuarentena en bloque movió los correos elegidos y se verificó en
los buzones.

---

## Entrada 10 — 2026-10-16: Cerrar el caso, poner límites a la automatización, y una app en un solo idioma

### Contexto

Hasta esta sesión, el ciclo de vida de un incidente terminaba en "mitigado":
no había forma de decir si la alerta era un ataque real, una actividad
legítima o un error de la detección, ni de buscar casos anteriores. Y la
automatización, recién implementada, se había diseñado pero nunca revisado
con ojo crítico. La sesión trabajó las dos cosas, y terminó con la primera
prueba de la app completa en el celular.

### El veredicto como dato

Cerrar un caso ahora exige un veredicto: verdadero positivo (un ataque real),
benigno positivo (la detección fue correcta pero la actividad era legítima,
por ejemplo un escaneo autorizado) o falso positivo (la detección fue
errónea). Son las mismas tres categorías que usa la industria para el triaje
y el dataset GUIDE de Microsoft. Se suman etiquetas de un catálogo fijo —las
del sistema se ponen solas: el caso de uso al crear el incidente y la acción
al contenerlo— y una nota, obligatoria cuando no hubo ataque real, porque
descartar una alerta es la decisión que más cuesta si está mal. Por la misma
razón, cerrar como falso positivo pide verificación biométrica.

Esto tiene un segundo propósito. Un modelo de aprendizaje automático para
priorizar alertas necesita ejemplos etiquetados, y el proyecto no puede usar
datos sintéticos. Cada cierre es un ejemplo etiquetado por un analista sobre
un incidente real, con su contexto completo: la plataforma genera, mientras
se usa, el dataset que haría falta para entrenarlo.

El veredicto también sirvió enseguida para otra cosa: medir la precisión de
cada política de automatización. De los casos que una política contuvo, o
habría contenido en simulación, cuántos terminaron cerrados como ataque real.
Es la evidencia que un administrador necesita para decidir si activar,
ajustar o apagar una política.

### Auditar la automatización

La revisión de cómo la automatización usa el contexto encontró que el diseño
resiste bien —ante un dato faltante no actúa, cada decisión es explicable,
usa el mismo código que el analista y solo un administrador la configura—,
pero también cinco debilidades concretas, que se corrigieron.

La más grave era silenciosa: la lista de exclusión solo entendía direcciones
IPv4. Una IPv6 excluida nunca coincidía, y esa IP se habría bloqueado igual;
era el único caso en que el sistema fallaba del lado inseguro. Las otras eran
de gobierno: no había límite al daño que una política mal configurada podía
hacer, un activo que no figuraba en el inventario se trataba como de
criticidad media, y la auditoría de un cambio de configuración decía el valor
nuevo pero no el anterior.

El límite al daño se resolvió con un cortacircuitos: si la automatización
ejecuta más de cierta cantidad de acciones en una ventana de tiempo (cinco en
diez minutos por defecto), se pasa sola a modo simulación, lo avisa en la
app, y el caso queda para el analista. Volver a activarla es una decisión
explícita de un administrador. Un activo desconocido pasa a considerarse de
criticidad alta: en una empresa real el inventario nunca está completo, y lo
que no se conoce no se automatiza. Quedaron identificados como trabajo futuro
deshacer una acción automática, condiciones basadas en comportamiento, la
sincronización del inventario con una CMDB o con los grupos de agentes de
Wazuh, y probar una política contra incidentes pasados antes de activarla.

### Un solo idioma, en un solo lugar

La app mezclaba inglés y español. Se tradujo completa, y en lugar de
reemplazar textos pantalla por pantalla, todos quedaron en un único archivo,
organizado por pantalla: agregar otro idioma es escribir una copia de ese
archivo, sin tocar las pantallas. Los valores internos (estados, roles,
criticidades) siguen en inglés, de modo que la API y los datos guardados no
cambiaron. Los mensajes que el servidor muestra en la app —errores, eventos
de auditoría, motivos de la automatización— también pasaron al español.

### Lo que encontró el celular

La prueba en un dispositivo real mostró problemas que no aparecían en el
código: el teclado tapaba la nota de cierre (en Android, con la pantalla de
borde a borde, la ventana ya no se achica sola), las etiquetas se veían
desparejas, las pantallas de la acción tenían márgenes distintos al resto, no
se podía copiar una IP para buscarla, y el motivo largo de una decisión
automática se cortaba. También dejó en evidencia un hueco de trazabilidad:
cuando Wazuh rechazaba una acción del analista, el intento no quedaba en la
auditoría. Ahora queda, con quién lo intentó y por qué falló.

### Resultado

El incidente tiene ahora un ciclo de vida completo —detectado, agrupado,
contenido (por el analista o por una política), cerrado con veredicto, y
reabierto si aparece información nueva—, la automatización tiene límites
explícitos y una medida de su propia precisión, y la app habla un solo
idioma. 155 tests, con 98,9 % de cobertura de líneas.

### Próximo paso

Desplegar estos cambios, medir la contención automática contra la
infraestructura real para compararla con la manual en las Conclusiones, y
terminar las correcciones del documento para la entrega del 20/10.

---

## Entrada 9 — 2026-10-14 al 15/10: De la devolución de E50 a una plataforma que decide sola cuando es seguro

### Contexto

La devolución de la entrega E50 aprobó el trabajo, pero marcó como críticas
tres faltas que eran del producto y no del documento: los requerimientos de
rendimiento no tenían ningún número ("en el orden de segundos", "dentro del
SLA definido"), no había forma de eliminar una cuenta, y no se mencionaba la
Ley 25.326 de protección de datos personales. Estas sesiones resolvieron las
tres, y en el camino el producto ganó lo que lo distingue de una aplicación
de botones: decide solo cuando el caso es claro y de bajo riesgo.

### Medir antes de prometer

En lugar de escribir una cota estimada, se instrumentó el sistema para medir
tres tiempos de cada incidente: de la alerta de Wazuh a que el incidente
existe, cuánto tarda en ejecutarse la acción, y la contención completa
(alerta → mitigado, incluida la decisión del analista). Una campaña de
medición contra la infraestructura real, con el analista operando desde el
celular, dio una contención mediana de 21,1 segundos y un percentil 95 de
31,3 segundos, frente a los 8 a 14 minutos del modelo de acceso remoto
tradicional: entre 23 y 40 veces menos. Con esos datos se propusieron las
cotas (detección ≤ 5 s, ejecución de la acción ≤ 2 s, contención ≤ 60 s, todas
en percentil 95), defendibles porque cada una es el valor medido más un
margen explícito.

El dato más revelador fue otro: el sistema aporta alrededor de 1,5 segundos;
el 94 % del tiempo de contención es la decisión humana. Si el objetivo es
contener más rápido, el próximo salto no está en optimizar el sistema sino en
no esperar al analista cuando no hace falta.

### Privacidad y usuarios reales

La eliminación de la cuenta chocaba con una obligación de seguridad: borrar
el registro de auditoría haría desaparecer, por ejemplo, el rastro de quién
aisló un equipo. Se resolvió con seudonimización: el perfil se borra y, en
cada evento de auditoría, la persona se reemplaza por un seudónimo estable
que no se puede revertir sin un secreto del servidor. Se agregaron además
una política de retención (las IPs de los atacantes se enmascaran a su red a
los 90 días), el aviso de privacidad en la app y el consentimiento en el
registro.

Eso dejó en evidencia que el sistema tenía un único usuario configurado en el
servidor, cuando el documento promete control de acceso por roles. Se
implementaron usuarios reales con contraseña protegida por hash, tres roles
(administrador, analista y auditor de solo lectura) y registro con
aprobación: la cuenta nace pendiente y con el rol de menor privilegio, y
nadie se da acceso a sí mismo. El rol se verifica contra la base en cada
solicitud, de modo que desactivar a alguien corta su sesión en el acto, y el
sistema impide quedarse sin administradores.

### Agrupar para triar

La campaña mostró además que cada ataque de fuerza bruta generaba dos
incidentes, porque Wazuh dispara una regla por el servicio SSH y otra por el
módulo de autenticación del sistema: el analista mitigaba uno y el otro
quedaba abierto. Se agrupan ahora las alertas del mismo agente y la misma IP
de origen mientras el incidente siga abierto y dentro de una ventana de 10
minutos; un incidente ya mitigado no absorbe alertas nuevas, para que un
intento posterior a la contención se vea como lo que es.

### Autonomía graduada

La automatización se diseñó para que sea defendible ante un tribunal de
seguridad, no solo rápida. Un administrador define políticas —por ejemplo,
"fuerza bruta desde una IP con mala reputación contra un activo no crítico →
bloquear", o "archivo detectado por diez o más motores de VirusTotal →
aislar"— combinando la reputación de la IP, el país, la detección del
archivo y la criticidad del activo afectado, registrada en un inventario.
Por encima de cualquier política hay reglas fijas: un activo crítico nunca se
mitiga solo, una IP de la lista de exclusión nunca se bloquea, y un dato
faltante cuenta como condición no cumplida: ante la duda, no se automatiza.
El sistema arranca en modo simulación, en el que registra lo que habría hecho
sin ejecutarlo, y solo un administrador, con verificación biométrica, puede
activarlo. Toda decisión queda guardada en el incidente con la política que
la motivó, y en la auditoría con el actor "automation".

Esto cambia un principio del diseño original, que exigía la verificación
biométrica para toda acción crítica: las acciones automáticas no la tienen,
pero están gobernadas por una política que un administrador aprobó con esa
verificación. Es el paso de un humano en el ciclo a un humano sobre el
ciclo, reservado a los casos de bajo riesgo, y está respaldado por las
entrevistas: uno de los profesionales consultados señaló explícitamente que
permitiría acciones de contención inmediata y de bajo riesgo sin aprobación
previa.

La primera prueba de punta a punta encontró un defecto de diseño: la
automatización solo decidía al crear un incidente, así que una alerta que se
sumaba a un incidente abierto —por ejemplo, después de activar el modo
automático— nunca se contenía. Ahora cada alerta agrupada provoca una nueva
evaluación.

### Trazabilidad del caso

Agrupar alertas tenía un costo: se perdía la evidencia individual. Cada
alerta queda ahora registrada con lo que la distingue (el archivo infectado,
o el usuario que el atacante intentó usar), guardando solo los campos útiles
y no la alerta completa, por minimización de datos. Los eventos de auditoría
quedaron vinculados a su incidente y clasificados por categoría. En la app,
el detalle de cada caso muestra la evidencia y el registro de lo que se hizo,
con quién y cuándo, y el registro general del sistema se puede filtrar por
tipo de evento.

### Una lección sobre las pruebas

Varias veces las pruebas automatizadas fallaron por algo ajeno al código: se
ejecutaban contra la base de datos de desarrollo, que conservaba el estado de
las pruebas manuales —en un caso, la automatización activada, ejecutando
acciones en pruebas que no lo esperaban—. Las pruebas usan ahora su propia
base, creada de cero en cada corrida, igual que en la integración continua.
La suite pasó de 49 a 130 pruebas, con una cobertura del 98,7 % de las
líneas.

### Próximo paso

Medir la contención automática para compararla con la manual en las
Conclusiones, e incorporar al documento las cotas, el modelo de datos y el
contrato de API reales y los diagramas, de cara a la entrega del 20/10.

---

## Entrada 8 — 2026-10-06 al 13/10: El pipeline funcionando, el aislamiento real, y 1.320 alertas que nadie había pedido

### Contexto

La entrada anterior dejó el despliegue automático a medio camino y el caso de
uso CU-02 (aislar un endpoint infectado) con la detección validada pero la
acción nunca ejecutada contra Wazuh real. Estas sesiones cerraron las dos
cosas, y al verificarlas apareció un problema que no estaba en ningún plan:
el sistema estaba generando cientos de incidentes que no correspondían a
ningún ataque.

### La app para dos casos de uso

La app solo sabía bloquear una IP. Se generalizó el flujo de respuesta
(autenticación biométrica → confirmación → ejecución → resultado) para que
la acción dependa del tipo de incidente: si el incidente tiene una IP
atacante (fuerza bruta, CU-01) se ofrece **bloquear IP**; si no la tiene
(malware en el host, CU-02) se ofrece **aislar host**. El step-up biométrico
se mantiene para las dos: el plan lo define como irrenunciable para
cualquier acción crítica. Se sumó además la tarjeta de inteligencia de
amenazas, que muestra en el detalle del incidente lo que VirusTotal y
AbuseIPDB saben de la IP atacante.

### El aislamiento que decía funcionar y no funcionaba

La primera prueba real de CU-02 fue engañosa: la app mostró éxito, la API de
Wazuh respondió OK, pero el endpoint seguía aceptando conexiones. Ningún log
registraba un error. La causa: cuando la API de Wazuh recibe un comando con
el prefijo `!`, ejecuta un archivo con ese **nombre exacto** en el agente. El
bloqueo funcionaba porque el ejecutable se llama `firewall-drop`, sin
extensión; el script de aislamiento se había instalado como
`isolate-host.sh`, y el agente buscaba `isolate-host`. Al no encontrarlo,
no hacía nada y no avisaba. Corregido el nombre, el aislamiento funcionó: el
endpoint dejó de aceptar conexiones nuevas mientras el agente de Wazuh
seguía reportando al manager, que es exactamente el diseño (cortar todo
salvo el canal que permite revertir la acción).

Es el mismo patrón que ya había aparecido en agosto con el bloqueo: un
sistema que confirma una acción que no ejecutó. Por eso las pruebas
automatizadas posteriores priorizan justamente ese modo de falla.

### El pipeline, sin el gate que se había diseñado

El diseño original preveía una aprobación manual en GitHub (un Environment
con revisores) antes de aplicar cambios de infraestructura. Al
configurarlo apareció que requiere permisos de administrador del
repositorio, que el equipo no tiene. En lugar de forzar la configuración se
reemplazó por dos frenos que no dependen de ella: el merge del Pull Request
pasa a ser la aprobación humana, después de leer el plan de Terraform que el
CI comenta automáticamente en el PR; y el propio pipeline aborta si el plan
destruye o reemplaza cualquier recurso. El segundo freno ataja exactamente
el incidente del 26/08 (un plan que proponía reemplazar las tres instancias
por un falso positivo) aunque nadie lea el plan.

Había además una razón de seguridad para no insistir con el Environment:
cuando un job de GitHub usa uno, la identidad que presenta ante AWS cambia
de "rama main" a "environment production". Aceptarla obligaba a ampliar la
política de confianza del rol de despliegue, y sin reglas de rama en el
Environment (que también requieren administrador) cualquier rama podría
haber asumido el rol. Se mantuvo la restricción original: solo `main`.

La primera ejecución real en GitHub encontró dos errores que localmente no
se veían: GitHub reserva el prefijo `GITHUB_` en los nombres de variables, y
dos pruebas dependían de un valor que en la notebook venía del archivo
`.env` local, inexistente en el servidor de CI. Corregidos, el 13/10 corrió
el primer despliegue automático completo: merge → plan → freno → apply →
actualización del orquestador por AWS SSM, sin SSH y sin credenciales
guardadas.

### 1.334 incidentes

Al verificar ese primer despliegue desde la app, el analista vio más de
1.300 incidentes, cuando una semana antes había una docena. Una consulta a
la base mostró que 1.320 no eran ataques: eran cambios de archivos del
sistema y paquetes instalados por las actualizaciones automáticas de
Ubuntu, que llegaban en tandas a las 06 y a las 11 UTC. Dos configuraciones,
correctas cada una por separado, se combinaban mal: el monitoreo de
integridad de archivos (activado para CU-02) vigilaba también las carpetas
del sistema, y la integración que envía alertas al orquestador dejaba pasar
cualquier alerta a partir de cierto nivel de severidad, sin mirar su tipo.

Es, a escala de laboratorio, el problema central que un SOAR tiene que
resolver: la **fatiga de alertas**. Un analista de guardia que abre la app a
las 3 de la mañana y encuentra 1.300 alertas no encuentra el ataque real. Se
filtró en tres capas: el manager de Wazuh solo envía las familias de reglas
de los casos de uso (fallas de autenticación compuestas y detecciones de
VirusTotal); el orquestador aplica el mismo criterio de forma versionada y
probada, para no depender solo de configuración manual del servidor; y el
monitoreo de integridad del endpoint se redujo a la carpeta del caso de uso.
Una prueba con un archivo malicioso nuevo confirmó que lo relevante sigue
llegando. La base de producción se depuró con un script que por defecto
solo muestra lo que borraría, previo respaldo: de 1.335 a 15 incidentes
reales.

El filtro tiene un costo que conviene explicitar: la regla que detecta
varios intentos fallidos seguidos de un login exitoso (40112) quedó afuera,
aunque es de alto valor, porque en las pruebas se disparaba con la propia
laptop del administrador. Queda anotada para evaluarla.

### Cobertura de pruebas

Para la entrega del 20/10 se pidió una cobertura superior al 85%. El punto
de partida era 76% de líneas, y el hueco principal estaba en el cliente de
la API de Wazuh (14%): todas las pruebas lo reemplazaban por un simulacro,
así que el código que habla con Wazuh nunca se probaba. Se agregaron pruebas
para los modos de falla reales del proyecto (Wazuh respondiendo "OK" con la
acción fallida en el cuerpo de la respuesta) y para la tolerancia a fallas de
los servicios auxiliares (que una caída de VirusTotal o de la auditoría no
interrumpa el registro de un incidente ni el login). Resultado: 98,9% de
líneas, 91,5% de ramas, 96,9% de funciones, 49 pruebas. El umbral quedó como
regla del CI: si la cobertura baja del 85%, el cambio no se integra. El
anexo de pruebas de la tesis se genera automáticamente desde la corrida real,
para que sus números nunca se desincronicen del código.

### Próximo paso

Revisar el anexo para la entrega del 20/10 y abordar la agenda de
arquitectura: base de datos gestionada, escalabilidad, firewall de
perímetro y disponibilidad.

---

## Entrada 7 — 2026-10-05: Automatizar el deploy, y descubrir que la infraestructura no tenía memoria

### Contexto

El objetivo era armar la base para que un push a `main` actualizara la
infraestructura real de AWS sin reinstalar nada. La restricción de diseño
venía del propio historial del proyecto: el 26/08 un `terraform apply` casi
reemplaza las tres instancias por un falso positivo, y lo único que lo
evitó fue que alguien leyó el plan antes de confirmar. Automatizar el
`apply` sin esa revisión era reproducir el riesgo sin nadie mirando.

### El diseño: validar automático, aplicar con freno

Se separaron dos niveles. En cada Pull Request, GitHub Actions corre
`terraform plan` y los tests del orchestrator con un rol de solo lectura
— automático y sin riesgo, porque no puede modificar nada. En cada push a
`main`, el `apply` queda pausado detrás de un Environment de GitHub
(`production`) que exige aprobación humana: la revisión que salvó al
proyecto el 26/08, convertida en paso obligatorio.

La autenticación contra AWS se hizo por OIDC en vez de guardar claves de
acceso como secretos del repositorio: GitHub obtiene credenciales
temporales que solo valen para este repositorio, y el rol con permisos de
escritura solo puede asumirse desde la rama `main`. Es, además, coherente
con el argumento central de la tesis — verificación explícita y mínimo
privilegio — aplicado a la propia cadena de despliegue. El deploy del
código del orchestrator usa SSM Run Command en lugar de SSH, lo que
elimina la dependencia del puerto 22: el mismo puerto que la red de la
facultad bloquea por protocolo, y que para los runners de GitHub (con IPs
dinámicas) obligaría a abrir más de lo razonable.

### El hallazgo: no había state

Antes de aplicar nada, al preparar el primer `terraform plan` desde la
laptop, apareció el problema de fondo: el archivo de state de Terraform no
existía en ningún lado. No había backend remoto configurado, el archivo
está correctamente excluido de git, y la máquina que hizo el `apply`
original no era esta. Sin state, Terraform no sabe que las instancias
existen: un `plan` hubiera propuesto crearlo todo de nuevo, y un `apply`
hubiera intentado duplicar instancias y Security Groups en paralelo a los
reales.

Se reconstruyó con `terraform import`, recurso por recurso — una
operación de solo lectura hacia AWS que registra en el state lo que ya
existe. En el camino aparecieron dos detalles operativos: en Windows el
lock del state local no hace cola, así que los imports en paralelo fallan
de inmediato y hay que correrlos en serie; y un corte de la máquina dejó
un proceso de Terraform colgado sosteniendo el lock, que hubo que terminar
antes de seguir. El state, al escribirse de forma atómica, no se corrompió:
quedó en el último import completo.

### El plan, leído antes de aplicar

Con el state reconstruido, el plan se revisó línea por línea. Ninguna
instancia se reemplazaba (todas "update in-place"), y el cambio en
`user_data` venía acompañado de `user_data_replace_on_change = false`, es
decir, sin reinstalación de Wazuh. El único recurso marcado para destruir
fue el key pair, por una limitación conocida del import (no trae la clave
pública al state); se aplicó tras verificar que las instancias lo
referencian solo por nombre, que el contenido de la clave era idéntico, y
que un key pair solo importa al lanzar instancias nuevas. Resultado: 9
recursos creados, 6 modificados en el lugar, 1 reemplazado, sin tocar
ninguna instancia de forma destructiva. De paso se fijó el AMI de las
instancias (antes se resolvía "el más reciente" en cada `apply`, lo que
podía forzar el reemplazo de las tres el día que Canonical publicara una
imagen nueva).

### Lo que falta

El pipeline no funciona todavía de punta a punta. El bloqueante técnico es
el backend remoto: mientras el state viva solo en la laptop, cada corrida
de GitHub Actions arrancaría exactamente en la situación que hubo que
remediar hoy. El resto es configuración manual en GitHub (variables con
los ARN de los roles y el Environment con aprobadores) y migrar el
directorio del orchestrator en la instancia a un clone de git.

### Próximo paso

Backend remoto en S3 para el state, antes de mergear cualquier cambio que
dispare el workflow de deploy.

---

## Entrada 6 — 2026-10-02: Enriquecimiento, CU-02 validado contra infra real, y tres bugs de infraestructura que llevaban semanas escondidos

### Contexto

El pedido de esta sesión fue avanzar en los dos casos de uso que seguían
"fuera del MVP": el enriquecimiento de IP vía VirusTotal/AbuseIPDB (candidato
"si sobra tiempo" desde el `PLAN.md` original) y CU-02, aislar un endpoint
ante una infección de equipo — uno de los dos PoC que la propuesta formal
comprometía y que `TESIS_CAPITULOS.md` documentaba como "no implementado,
dependencia externa no resuelta". La sesión terminó demostrando algo más
general sobre el estado de la infraestructura: el manager de Wazuh llevaba
semanas con el disco casi lleno y el DNS roto, sin que nadie lo supiera,
porque ninguna tarea anterior había necesitado resolver un dominio externo
ni había llenado el disco lo suficiente como para notarlo.

### Enriquecimiento: la parte fácil, hecha primero a propósito

Antes de tocar CU-02, se implementó el enriquecimiento de IP
(`orchestrator/src/enrichment.js`): consulta VirusTotal y AbuseIPDB en
paralelo, cachea el resultado 24 horas por IP para no agotar el rate limit
gratuito de ninguna de las dos APIs, y no pega a la red en absoluto si falta
alguna de las dos API keys — así un desarrollador sin credenciales, o la
suite de tests, nunca dependen de que existan. Se disparó de forma
asíncrona desde el webhook, sin bloquear la respuesta a Wazuh (que no debe
quedar esperando una llamada externa). Validado con las keys reales contra
`8.8.8.8`: ambas APIs devolvieron datos reales (reputación limpia, 216
reportes históricos en AbuseIPDB). Se eligió este orden —lo más simple y
más barato primero— tanto por practicidad como porque cierra un hueco real
de la rúbrica de evaluación del PFI (el criterio "tendencias en
informática" no tenía ningún candidato implementado todavía).

### CU-02: un bug encontrado antes de tener infraestructura para probarlo

El backend de CU-02 se escribió reusando exactamente el patrón ya probado
de CU-01: un script de active-response nuevo
(`orchestrator/integrations/isolate-host.sh`) que, a diferencia de
`firewall-drop` (que bloquea una IP puntual), aísla al propio agente que lo
ejecuta —permite loopback, conexiones ya establecidas, y el tráfico hacia/
desde el manager, y dropea todo lo demás mediante una cadena `iptables`
dedicada que se puede revertir con el mismo script—; un endpoint
`POST /api/v1/incidents/:id/actions/isolate-host` en el orchestrator,
simétrico a `block-ip`; y tests unitarios con el mismo mocking que ya
usaba `blockIp.test.js`.

Antes de desplegar nada, una auditoría de código contra la forma real de
una alerta de Wazuh encontró un problema que ningún test anterior hubiera
atrapado: `normalize.js` exigía el campo `srcIp` en toda alerta, pero una
alerta de FIM o de detección de malware (que es, justamente, lo que
dispara CU-02) no tiene IP de atacante — es un evento sobre el propio host,
no una conexión de red entrante. Se corrigió haciendo `srcIp` opcional
tanto en la normalización como en el schema de Prisma, y se armó un mock
realista de una alerta de VirusTotal (`mocks/wazuh_malware_detected.json`,
con la forma documentada que Wazuh realmente usa) para cubrirlo con un
test antes de tener ninguna infraestructura real contra la cual probarlo.
Horas después, la misma causa exacta apareció en producción contra la
alerta real — confirmando que la auditoría de código, hecha a tiempo, había
encontrado un bug real y no uno hipotético.

### El obstáculo de siempre: SSH bloqueado, resuelto distinto esta vez

La sesión arrancó con el mismo problema de sesiones anteriores en
ubicaciones con redes restringidas: SSH directo contra las instancias de
AWS fallaba. Esta vez se diagnosticó hasta la causa raíz en vez de
asumirla: la conexión TCP se completaba, pero abortaba apenas el cliente
mandaba el banner `SSH-2.0-...` — y lo mismo pasaba contra un servidor de
test completamente ajeno (`test.rebex.net`), descartando cualquier causa
del lado de AWS. El patrón es el de un firewall de inspección de
aplicación (tipo Palo Alto) que permite el handshake TCP pero corta por
firma de protocolo SSH, a cualquier destino — no tiene arreglo posible del
lado del proyecto.

La salida fue EC2 Instance Connect: SSH iniciado por AWS desde su propia
infraestructura hacia la instancia, que desde la perspectiva del cliente es
tráfico HTTPS normal al navegador — nunca sale SSH directo desde la red
restringida. Requirió abrir el puerto 22 a `0.0.0.0/0` en los Security
Groups del manager y del orchestrator (el de la víctima ya estaba abierto
de una sesión anterior) — cada instancia tiene su propio SG independiente,
así que hubo que repetir el cambio tres veces, con un tropiezo en el medio
(una edición de la consola creó una regla nueva en el puerto 0 en vez de
editar la regla de puerto 22 existente, que no hacía nada hasta que se
corrigió). Queda pendiente decidir si esos SG se revierten a `var.my_ip`
antes de la demo real o si se busca una mitigación distinta.

### Tres bugs de infraestructura, encontrados por necesitar DNS por primera vez

Con acceso ya resuelto, aparecieron en cadena tres problemas que llevaban
tiempo ahí sin que nadie los notara, todos en el manager de Wazuh:

**Disco lleno.** El manager no arrancaba (`No space left on device`). El
disco de 30GB (`var.root_volume_gb`, el default de Terraform) estaba al
100%, y `/var/ossec/queue/vd` + `/var/ossec/queue/vd_updater` —la caché del
módulo Vulnerability Detector de Wazuh, que descarga feeds de CVE (NVD,
OVAL)— concentraban 23 de esos 30GB, acumulados sin límite desde la
instalación del 21/08. Ningún caso de uso del proyecto usa escaneo de
vulnerabilidades, así que se vació la caché (recuperable, no son datos
propios) y se desactivó el módulo (`<vulnerability-detection><enabled>no
</enabled>`) para que no vuelva a pasar.

**DNS roto.** Con el disco liberado y el manager arriba, la integración de
VirusTotal seguía sin funcionar — no con un error claro, sino en silencio.
El motivo: `/etc/resolv.conf` no existía. El symlink que debería apuntar a
`/run/systemd/resolve/stub-resolv.conf` se había perdido en algún momento
no determinado; `systemd-resolved` funcionaba bien internamente (confirmado
con `resolvectl status`), pero nada que use la resolución estándar de
glibc —Python, `curl`, y hasta el propio `sudo` al intentar resolver su
propio hostname para el log de auditoría— podía resolver ningún dominio.
Esto explica, en retrospectiva, el `sudo: unable to resolve host ...` que
apareció en *todos* los comandos `sudo` de la sesión desde el principio:
siempre fue el mismo síntoma, invisible porque nunca había bloqueado nada
hasta que hizo falta resolver `www.virustotal.com` de verdad. Arreglado
recreando el symlink.

**La API de VirusTotal que usa Wazuh está retirada.** Con DNS funcionando,
la consulta a VT seguía fallando. La causa, esta vez, no era de este
proyecto: el script nativo que trae Wazuh 4.8.2
(`/var/ossec/integrations/virustotal.py`) usa la API v2 de VirusTotal
(`vtapi/v2/file/report`), que VirusTotal retiró por completo en 2024 — no
responde para ninguna API key nueva, sea cual sea su validez. Se parcheó el
script (`request_virustotal_info()` y `query_api()`) para usar la API v3
(`/api/v3/files/{hash}`, header `x-apikey`), con la misma lógica que ya
estaba validada en `enrichment.js`. Un detalle operativo no menor: la
terminal del navegador de Instance Connect corrompe cualquier pegado de
más de un par de KB (confirmado con un archivo de ~230 líneas que llegó
con contenido duplicado y mezclado) — el archivo final se transfirió en 9
fragmentos de ~1500 bytes cada uno, concatenados con `echo -n ... >>` y
verificados con `md5sum` contra el hash esperado antes de instalarlo.

Confirmado con una llamada manual al script en modo debug: VirusTotal
devolvió `65/75` motores detectando el hash del archivo EICAR (el string de
test estándar de la industria, inocuo, reconocido por cualquier motor
antivirus — no hace falta malware real para probar esto).

### Resultado: CU-02 detecta de punta a punta, contra infraestructura real

Con los tres bugs resueltos y el código desplegado (una branch nueva,
`feature/cu02-enrichment-backend`, para no tocar `main` ni la branch con
historia de incidente ya documentada; código llevado al orchestrator real
vía `git clone` a un directorio temporal y copia selectiva de archivos, sin
tocar el `.env` de producción), se repitió la prueba de punta a punta real:
soltar el EICAR en un directorio vigilado de la víctima. Esta vez el flujo
completo corrió solo: FIM lo detectó, Wazuh consultó VirusTotal, 65 de 75
motores lo marcaron malicioso, se generó la alerta nativa de Wazuh
(`ruleId 87105`, nivel 12), el webhook la posteó, y el incidente apareció
real en `GET /api/v1/incidents` del orchestrator desplegado — sin ninguna
inyección manual, igual que CU-01 en su momento.

Queda pendiente la otra mitad de CU-02: la *acción* de aislamiento
(`isolate-host`) está escrita, deployada (script en el agente, comando
registrado en `ossec.conf`) y probada con mocks, pero nunca se ejecutó un
aislamiento real invocando la API de Wazuh contra un incidente real — el
mismo nivel de validación que ya tiene `block-ip` desde la Fase 0, todavía
no alcanzado acá. Tampoco hay UI en la app para ninguna de las dos cosas
agregadas esta sesión (enriquecimiento ni CU-02) — decisión explícita:
backend primero, contra infraestructura real, antes de construir sobre algo
sin probar.

### Próximo paso

Probar `isolate-host` contra Wazuh real, con el mismo rigor que
`block_ip.js` en la Entrada 1 (confirmar el aislamiento efectivo en
`iptables` de la víctima, no solo que la API responda `200`). Después: UI
en la app para lo de hoy, y los pendientes de siempre — video de respaldo,
ensayo cronometrado.

---

## Entrada 5 — 2026-08-30: Un incidente de git, reconstruir el backend, e integrar el diseño sin heredar sus regresiones

### Contexto

El pedido de esta sesión era simple de enunciar: que la app dejara de tener
cualquier dato simulado — el dashboard, el perfil de usuario, el log de
actividad — y que además se aprovechara el trabajo visual que había hecho
Lola en su branch (`unificacion-backend-frontend`), rediseñando buena parte
de las pantallas bajo la marca "Fortia". El PLAN.md original ya contemplaba
un `GET /api/v1/audit` opcional; lo que faltaba era decidir cómo incorporar
un rediseño ajeno sin repetir el problema que ya se había evitado una vez,
el 24/08, cuando se decidió no mergear esa misma branch porque reimplementaba
el backend entero sin la integración real de Wazuh.

### El incidente

A mitad de sesión, sin que nadie lo pidiera, el repositorio apareció parado
en `unificacion-backend-frontend` — la branch descartada — con un merge ya
aplicado que había traído su backend paralelo. Los archivos que sostienen
todo el proyecto (`orchestrator/src/auth.js`, `db.js`, `normalize.js`,
`wazuh.js`, y sus tests) habían desaparecido del árbol de trabajo, sin que
`git status` mostrara ninguna eliminación pendiente: no era un cambio sin
commitear, era el estado real de esa branch.

La causa, una vez reconstruida, fue una combinación de dos comandos
ejecutados en el momento equivocado: un `checkout` a la branch descartada,
seguido de un `git reset --hard origin/main` con la intención de "volver
para atrás". El `reset --hard` hace exactamente lo que promete — descarta
cualquier cambio sin commitear en el árbol de trabajo — pero eso incluía
todo el trabajo de la sesión que todavía no se había guardado: el rate
limiting recién agregado, el campo `ruleDescription`, las actualizaciones a
`PLAN.md` y `README.md`. Nada de eso estaba perdido de forma permanente en
el sentido de "corrompido" — nunca había llegado a existir como commit — así
que no había manera de recuperarlo con git. Sí había, en cambio, una
pregunta más urgente que responder antes de tocar nada más: si el daño
había llegado a `main`.

No había llegado. `main` local y remoto seguían exactamente donde estaban
antes del incidente — el `reset` había apuntado a `origin/main` como
destino, no lo había modificado, y el merge problemático vivía únicamente
en la branch ya descartada, que además ya estaba publicada en el remoto tal
cual, sin haber tocado nunca la rama principal. La secuencia de verificación
fue deliberadamente conservadora: confirmar la branch actual, comparar
`main` contra esa branch archivo por archivo, confirmar que el commit
problemático no era alcanzable desde ningún remoto salvo el suyo propio, y
recién ahí volver a `main` (guardando en un `stash` lo que hubiera, por las
dudas, antes de cualquier cambio de branch). El costo real del incidente
terminó siendo, exclusivamente, rehacer un par de horas de trabajo sin
commitear — no perder nada de lo que ya estaba guardado.

La lección que queda, más allá del backend reconstruido: un `git reset
--hard` no pregunta qué se pierde, y un cambio de branch a mitad de sesión
puede dejar el árbol de trabajo pareciendo "el mismo repo de siempre"
mientras en realidad es otro. Verificar la branch activa y el estado real
del árbol de trabajo antes de asumir continuidad pasó a ser, desde acá, un
paso explícito y no una formalidad.

### Reconstruir sin mocks

Con `main` de vuelta, la parte constructiva de la sesión tuvo dos frentes.

El primero fue backend: además de rehacer el rate limiting y el
`ruleDescription` perdidos, se agregaron dos piezas nuevas — un modelo
`User` con `GET`/`PUT /api/v1/me`, y un modelo `AuditEvent` con
`GET /api/v1/audit`. Ninguno de los dos necesitó un endpoint de registro
real: el perfil se resuelve con un `upsert` sobre el `username` que ya trae
el JWT (la fila se crea sola la primera vez que el usuario autenticado la
pide, sin condición de carrera con el arranque del servidor), y el audit
log se llena solo, agregando una línea en los tres puntos donde ya pasaba
algo real — un login exitoso, un incidente detectado por el webhook, una IP
bloqueada. No hizo falta inventar ningún dato: alcanzó con registrar lo que
el sistema ya hacía.

El segundo frente fue reconciliar el diseño de Lola con esos datos reales,
pantalla por pantalla en vez de por branch completa. Revisando el diff de
su branch contra `main` (29 archivos) apareció un patrón que confirmó por
qué la decisión del 24/08 de no mergear en bloque había sido la correcta:
varias de esas pantallas no eran solo un rediseño visual, sino un
retroceso silencioso a datos simulados. La más elocuente fue
`loading.tsx`, que tenía una constante `MOCK_SUCCESS = true` literal y
nunca llegaba a llamar al backend — la pantalla que en la versión real mide
el tiempo exacto del bloqueo, el número central del pitch del proyecto,
había sido reemplazada por una animación con tiempos inventados.
`success.tsx` esperaba parámetros de navegación con otros nombres
(`ip`/`target`/`time` en vez de `srcIp`/`hostname`/`elapsedMs`), con un
fallback hardcodeado de `"1.4 seconds"` que se hubiera mostrado siempre,
sin importar cuánto tardara el bloqueo real. `incident.tsx` esperaba
recibir el incidente entero serializado como parámetro de navegación en
vez de buscarlo por `id`, así que hubiera quedado en blanco cada vez que se
tocara un incidente desde cualquier lista real.

El criterio que se aplicó fue separar explícitamente qué de cada pantalla
era diseño y qué era lógica de datos, y adoptar solo lo primero cuando lo
segundo estaba comprometido. El login y el registro sí se adoptaron
completos — su validación de contraseña y la marca "Fortia" eran una
mejora genuina sin ningún retroceso de datos — aunque el login pedía un
email con validación de formato en lugar de un username, y hubo que
adaptarlo antes de traerlo: el backend real usa un usuario fijo
(`analyst`), que nunca hubiera pasado esa validación, dejando el botón de
login permanentemente deshabilitado. Las pantallas con lógica comprometida
(`confirm`, `loading`, `success`, `incident`, `incidents`) conservaron su
código real intacto y solo incorporaron el componente de marca
(`BrandHeader`), para quedar visualmente consistentes con el resto sin
resignar ningún dato real. Se descartaron sin tocar, además, dos carpetas
completas de esa branch (`AppMicroSOAR/terraform/` y `AppMicroSOAR/docs/`)
que resultaron ser copias duplicadas de la infraestructura y la
documentación reales de la raíz del repo — adoptarlas hubiera dejado dos
versiones de la infraestructura y de la documentación conviviendo sin que
nada avisara del conflicto.

### Un bug de producción encontrado por el propio usuario

Ya con todo deployado a la instancia real de AWS, el login desde el
celular físico empezó a fallar con "Invalid credentials" a pesar de usar
la contraseña correcta. El diagnóstico se hizo por descarte, de afuera
hacia adentro: primero se confirmó que el servidor respondía bien
probando el login directo contra la instancia; después se confirmó que
Tailscale y la conectividad del celular estaban bien, pidiéndole a la app
del navegador del propio teléfono la misma URL que usa la app y
verificando que respondiera. Con la red y el servidor descartados como
causa, quedaba solo la propia lógica de la app — y ahí apareció el
problema real: el limitador de intentos de `/auth/login` (agregado en la
sesión anterior, 5 intentos cada 15 minutos) ya se había agotado durante
las pruebas, y el bloque `catch` del login mostraba el mismo texto
genérico de "credenciales inválidas" para cualquier error, sin distinguir
un `401` real de un `429` de límite excedido.

La solución tuvo dos partes. La inmediata, para destrabar la prueba, fue
reiniciar el proceso del orchestrator — el contador del limitador vive en
memoria, así que un reinicio lo resetea sin tocar nada más. La de fondo
fue ampliar el límite a 20 intentos (sigue siendo insignificante para un
ataque de fuerza bruta automatizado real, pero deja margen de sobra para
los typos de una demo en vivo) y diferenciar el mensaje de error según el
código de estado de la respuesta, para que un límite excedido nunca vuelva
a leerse como una contraseña incorrecta.

### Resultado

Al cierre de la sesión, la app no tiene ningún dato mockeado restante
—dashboard, perfil, actividad, incidentes— y el diseño visual de Lola quedó
incorporado donde sumaba, sin heredar ninguna de sus regresiones a datos
simulados. El incidente de git, aunque costó tiempo, terminó siendo también
la confirmación de que la disciplina de no mergear la branch completa el
24/08 había sido la decisión correcta: la misma branch, tres semanas
después, seguía teniendo el mismo problema de fondo.

### Próximo paso

Video de respaldo y ensayo cronometrado del guion completo — lo único que
queda de cara al 1 de septiembre que no es código.

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
