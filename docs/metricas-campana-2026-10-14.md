# Campaña de medición de tiempos de respuesta — 14/10/2026

> **Corrección 18/10 — línea de base.** La cifra de "8-14 minutos del modelo
> tradicional" que se usaba como comparación no tiene fuente verificable. Se
> reemplaza por **unos 10 minutos de evaluación por alerta** en un SOC
> comercial (Kersten, Mulders, Zambon, Snijders y Allodi, "Give Me
> Structure", SOUPS 2023, USENIX, pp. 97-111: *"we estimated an average
> assessment time of 10 minutes per alert"*, estimación hecha con los analistas
> T2/T3 de ese SOC). Es un **piso**: no incluye el acceso remoto en una guardia
> pasiva (equipo, VPN, consola), así que la mejora real es como mínimo la
> calculada. Contexto propio, sin calcular contra él: MTTR estimado de 30 a 60
> minutos (Entrevista 3 del relevamiento).
>
> Base para la tesis: corrección crítica de E50 (RNF-05 y "SLA" sin cota
> numérica) y capítulo de Conclusiones con métricas (requisito de E75).
> Datos leídos de la base de producción (`GET /api/v1/metrics` y la tabla
> `incidents`); cálculo en `orchestrator/src/metrics.js`.

## 1. Método

- **Infraestructura real** en AWS: manager Wazuh 4.8.2, endpoint víctima con
  agente Wazuh, orquestador (commit `2b8a86c`). App en un celular Android
  conectado por Tailscale, abierta en la lista de incidentes (refresco
  automático cada 10 s).
- **CU-01 (fuerza bruta SSH):** intentos de login fallidos contra la víctima
  hasta disparar la regla de Wazuh → el analista toca BLOCK IP con step-up
  biométrico → reinicio de la víctima entre corridas.
- **CU-02 (malware):** archivo de prueba EICAR en la carpeta vigilada → FIM →
  VirusTotal → el analista toca ISOLATE HOST con step-up → reinicio de la
  víctima entre corridas.
- **Tiempos medidos por incidente:**
  - *Detección → ingesta*: desde el timestamp de la alerta de Wazuh hasta que
    el orquestador crea el incidente (pipeline `integratord` + webhook).
  - *Ejecución de la acción*: desde que el orquestador recibe la orden
    confirmada hasta que Wazuh ejecutó la acción (login a la API + comando).
  - *Contención*: desde la alerta hasta el incidente mitigado. Incluye que el
    incidente aparezca en la app, la decisión del analista y el step-up
    biométrico: es el valor que se compara con la línea de base (~10 minutos
    de evaluación por alerta, Kersten et al., 2023; ver la nota del inicio).
- **Estadísticos:** mediana (p50) y percentil 95 (p95) por rango más cercano
  (siempre un valor observado). Con n = 6, el p95 coincide con el máximo.
- Los relojes del manager y del orquestador se sincronizan por NTP (Amazon
  Time Sync); la diferencia es despreciable frente a los valores medidos.

## 2. Resultados

| Tiempo | CU-01 (fuerza bruta) | CU-02 (malware) |
|---|---|---|
| Detección → ingesta | n = 9 · p50 **1,30 s** · p95 **1,71 s** | n = 15 · p50 **1,25 s** · p95 **1,27 s** |
| Ejecución de la acción | n = 6 · p50 **0,20 s** · p95 **0,20 s** | n = 6 · p50 **0,20 s** · p95 **0,21 s** |
| Contención total | n = 6 · p50 **22,6 s** · p95 **31,3 s** | n = 6 · p50 **18,3 s** · p95 **22,5 s** |

**Ambos casos de uso (12 corridas completas):** contención p50 **21,1 s**,
p95 **31,3 s**, mínimo 15,1 s, máximo 31,3 s, promedio 21,4 s.

### Corridas completas

| Incidente | Caso | Detección → ingesta | Acción | Contención | Decisión del analista |
|---|---|---|---|---|---|
| #1336 | CU-01 | 1,71 s | 0,20 s | 24,2 s | 22,5 s |
| #1347 | CU-01 | 0,77 s | 0,20 s | 21,6 s | 20,8 s |
| #1348 | CU-01 | 1,30 s | 0,20 s | 22,6 s | 21,3 s |
| #1350 | CU-01 | 1,17 s | 0,20 s | 15,1 s | 14,0 s |
| #1351 | CU-01 | 1,25 s | 0,20 s | 29,0 s | 27,8 s |
| #1354 | CU-01 | 0,84 s | 0,20 s | 31,3 s | 30,5 s |
| #1345 | CU-02 | 1,25 s | 0,21 s | 18,3 s | 17,1 s |
| #1355 | CU-02 | 1,24 s | 0,21 s | 19,0 s | 17,8 s |
| #1356 | CU-02 | 1,25 s | 0,20 s | 22,5 s | 21,3 s |
| #1357 | CU-02 | 1,25 s | 0,20 s | 21,1 s | 19,9 s |
| #1358 | CU-02 | 1,25 s | 0,20 s | 16,4 s | 15,1 s |
| #1359 | CU-02 | 1,25 s | 0,20 s | 15,4 s | 14,2 s |

"Decisión del analista" = contención − detección → ingesta: el tiempo entre
que el incidente existe y queda mitigado. Incluye la espera del refresco de la
app (hasta 10 s), la lectura del incidente, el step-up y la confirmación.

## 3. Lectura

1. **El sistema no es el cuello de botella.** Detección + ejecución suman
   alrededor de 1,5 s. El **94 %** del tiempo de contención es la decisión
   humana (p50 19,9 s), que además incluye hasta 10 s de espera del refresco
   de la app.
2. **Frente a la línea de base de ~10 minutos** (600 s, piso; ver la nota del
   inicio), la contención mediana de 21,1 s es **28 veces menor** (−96,5 %);
   tomando el peor caso medido (p95, 31,3 s), sigue siendo **19 veces menor**
   (−94,8 %).
3. **La detección es muy estable:** en CU-02, las 15 mediciones caen entre
   1,24 y 1,27 s. En CU-01 varía más (0,77-1,71 s), lo esperable en una regla
   de correlación por frecuencia.
4. **Cada fuerza bruta genera dos alertas** (reglas 5712 de sshd y 5551 de
   PAM): el analista mitiga una y la otra queda abierta. Es una mejora para
   el filtro: agrupar alertas de la misma IP en un mismo incidente.

## 4. Cotas propuestas (para RNF-05 y el "SLA")

Criterio: el p95 medido más margen para carga, red y variación entre
ejecuciones, redondeado a un valor fácil de verificar.

| Requerimiento | Cota | Medido (p95) | Margen |
|---|---|---|---|
| Detección → incidente registrado | **≤ 5 s** | 1,71 s | ~3× |
| Incidente visible en la app desde la alerta | **≤ 15 s** | 1,71 s + refresco ≤ 10 s | por diseño |
| Ejecución de la acción de contención (desde la confirmación del analista) | **≤ 2 s** | 0,21 s | ~10× |
| Contención total (alerta → mitigado, con decisión humana) — **SLA** | **≤ 60 s** | 31,3 s | ~2× |

### Redacción propuesta (formato "El sistema debe...")

- **RNF-05.** El sistema debe registrar un incidente en un plazo máximo de
  5 segundos desde que Wazuh emite la alerta, mostrarlo en la aplicación móvil
  en un plazo máximo de 15 segundos, y ejecutar la acción de contención en un
  plazo máximo de 2 segundos desde la confirmación del analista (percentil 95).
- **SLA de contención (RNF-07 / CU-01 / CU-02).** El sistema debe permitir
  completar la contención de un incidente, desde la alerta hasta la acción
  ejecutada, en un plazo máximo de 60 segundos (percentil 95), frente a los
  ~10 minutos que insume evaluar una sola alerta en un SOC (Kersten et al.,
  2023).

## 5. Limitaciones

- **n = 6 corridas completas por caso de uso:** suficiente para una cota
  inicial con margen, no para un estudio estadístico. Más corridas afinarían
  el p95.
- **Un solo analista**, que conoce el sistema y esperaba el incidente: en una
  guardia real, la decisión humana sería más lenta (alerta en un celular
  bloqueado, contexto a leer). La cota de 60 s deja margen para eso, pero no
  lo mide.
- **Sin notificaciones push:** el incidente aparece por refresco cada 10 s.
  Con push, la espera bajaría a casi cero.
- **Entorno de laboratorio:** una víctima, sin carga concurrente. La
  ejecución de la acción podría crecer con muchos agentes o con la API de
  Wazuh bajo carga.
- La línea de base (~10 minutos, Kersten et al., 2023) es una estimación de
  un SOC comercial con analistas en su puesto, no una medición propia del
  modelo tradicional en este entorno; por no incluir el acceso remoto, es un
  piso.

## 6. Contención automática — 18/10/2026

Complemento de la campaña: los mismos casos de uso, pero contenidos por la
**automatización según contexto** (`orchestrator/src/automation.js`), sin
intervención del analista. Es la comparación que piden las Conclusiones:
contención manual (humano en el ciclo) frente a automática (humano sobre el
ciclo, con políticas aprobadas por un administrador).

### Método

- Misma infraestructura real (manager Wazuh 4.8.2, víctima con agente,
  orquestador en producción) y mismo método de disparo que el 14/10:
  fuerza bruta SSH contra la víctima (CU-01) y archivo EICAR en la carpeta
  vigilada (CU-02), con reinicio de la víctima entre corridas.
- Configuración durante la medición, por la API de administración y
  auditada: modo **activo**; política "Fuerza bruta contra activo de
  criticidad baja (laboratorio)" habilitada (la política de producción exige
  reputación de AbuseIPDB ≥ 80, que la IP del laboratorio no tiene); política
  "Malware confirmado por VirusTotal" (≥ 10 motores) sin cambios; víctima con
  criticidad **baja** en el inventario; cortacircuitos subido de 5 a 50
  acciones / 10 min para que no interrumpa la medición.
- Al terminar se restauró todo: modo **simulación**, política de laboratorio
  deshabilitada, cortacircuitos en 5 / 10 min.
- Tiempos y estadísticos: los mismos que en la sección 1 (`automatedContainment`
  de `GET /api/v1/metrics`, separado de la contención manual).

### Resultados

| Tiempo | CU-01 (fuerza bruta) | CU-02 (malware) |
|---|---|---|
| Detección → ingesta | n = 3 · p50 **1,13 s** · p95 **1,71 s** | n = 3 · p50 **1,26 s** · p95 **1,26 s** |
| Ejecución de la acción | n = 3 · p50 **0,21 s** · p95 **0,21 s** | n = 3 · p50 **0,20 s** · p95 **0,29 s** |
| Contención total automática | n = 3 · p50 **1,83 s** · p95 **1,96 s** | n = 3 · p50 **1,51 s** · p95 **1,59 s** |

**Ambos casos de uso (6 corridas):** contención automática p50 **1,51 s**,
p95 **1,96 s**, mínimo 1,38 s, máximo 1,96 s, promedio 1,63 s.

| Incidente | Caso | Detección → ingesta | Decisión automática (ingesta → mitigado) | Acción | Contención |
|---|---|---|---|---|---|
| #1362 | CU-01 | 0,99 s | 0,83 s | 0,21 s | 1,83 s |
| #1363 | CU-01 | 1,13 s | 0,26 s | 0,21 s | 1,38 s |
| #1364 | CU-01 | 1,71 s | 0,25 s | 0,20 s | 1,96 s |
| #1365 | CU-02 | 1,25 s | 0,24 s | 0,20 s | 1,49 s |
| #1366 | CU-02 | 1,26 s | 0,34 s | 0,29 s | 1,59 s |
| #1367 | CU-02 | 1,26 s | 0,24 s | 0,20 s | 1,51 s |

Las 6 quedaron con `automationDecision = executed` y su evento de auditoría
con actor `automation` y la política aplicada.

### Lectura

1. **La decisión pasa de ~20 s a ~0,25 s.** En la contención manual, la
   decisión del analista era el 94 % del tiempo (p50 19,9 s). Automatizada,
   la decisión (evaluar la política y ejecutar) tarda p50 0,25 s; lo que queda
   es casi todo detección (~1,2 s).
2. **Contención automática frente a manual:** p50 1,51 s contra 21,1 s
   (**14 veces menor**, −92,9 %); p95 1,96 s contra 31,3 s (16 veces menor).
3. **Frente a la línea de base de ~10 minutos:** unas **400 veces menor**
   (p50), una reducción del **99,7 %**.
4. **Todas las corridas cumplen las cotas propuestas** con amplio margen
   (detección ≤ 5 s, ejecución ≤ 2 s, contención ≤ 60 s).
5. **El enriquecimiento pesa en la primera corrida de CU-01** (#1362: 0,83 s
   de decisión contra 0,25 s de las siguientes): la política se evalúa
   después de consultar VirusTotal y AbuseIPDB, y las corridas 2 y 3 usaron
   la caché de la misma IP. Un atacante nuevo paga ese costo (~0,6 s).

### Limitaciones

- n = 3 por caso de uso: alcanza para mostrar el orden de magnitud, no para
  un p95 estable.
- Política de laboratorio sin condición de reputación: en producción la
  política de fuerza bruta exige reputación ≥ 80 en AbuseIPDB, así que una IP
  sin historial no se bloquearía sola (queda para el analista). La medición
  muestra el tiempo de la contención automática cuando una política aplica,
  no con qué frecuencia aplica.
- Misma IP atacante en las 3 corridas de CU-01 (caché de enriquecimiento),
  una sola víctima, sin carga concurrente.

## 7. CU-03 (phishing reportado), contención manual — 18/10/2026

### Método

- Infraestructura real: servidor de correo de laboratorio (Postfix + Dovecot),
  orquestador en producción (lee el buzón de reportes por IMAP cada 15 s),
  app en el celular por Tailscale con refresco cada 10 s.
- 5 corridas: `send-phish` (llega la campaña a alice y bob y alice la reporta
  reenviando el original a `phishing@`) → el analista abre el incidente,
  toca PONER EN CUARENTENA con step-up y cierra el caso como verdadero
  positivo (cerrarlo hace que la corrida siguiente abra un incidente nuevo
  en vez de sumarse a la misma campaña).
- La "alerta" de CU-03 es la llegada del reporte al buzón `phishing@`
  (fecha interna IMAP). Detección → ingesta incluye la espera del chequeo
  periódico del buzón (0 a 15 s).
- Verificado en los Maildir: los correos de la campaña quedaron en
  `Quarantine` de ambos buzones; el correo legítimo siguió en el INBOX.

### Resultados

| Tiempo | CU-03 (n = 5) |
|---|---|
| Detección → ingesta | p50 **6,82 s** · p95 **11,83 s** (mín. 3,83 s) |
| Ejecución de la acción (cuarentena por IMAP en los buzones) | p50 **0,10 s** · p95 **0,11 s** |
| Decisión del analista (ingesta → cuarentena) | p50 **16,98 s** · p95 **31,88 s** |
| Contención total | p50 **25,37 s** · p95 **35,71 s** · promedio 26,81 s |

| Incidente | Detección → ingesta | Decisión | Acción | Contención |
|---|---|---|---|---|
| #1368 | 3,88 s | 16,98 s | 0,11 s | 20,85 s |
| #1369 | 10,83 s | 14,54 s | 0,10 s | 25,37 s |
| #1370 | 3,83 s | 31,88 s | 0,10 s | 35,71 s |
| #1371 | 11,83 s | 19,87 s | 0,09 s | 31,69 s |
| #1372 | 6,82 s | 13,60 s | 0,09 s | 20,42 s |

En #1368 la búsqueda de similares encontró además una variante de la
campaña de una prueba anterior (mismo adjunto), que entró en la misma
cuarentena.

### Lectura

1. **La contención de CU-03 (p50 25,4 s) es del mismo orden que la de CU-01 y
   CU-02 (21,1 s)** y cumple la cota de contención (≤ 60 s) con margen.
2. **La diferencia está en la detección:** 6,8 s de mediana contra ~1,3 s de
   Wazuh, por el chequeo periódico del buzón cada 15 s. **No cumple la cota
   de detección de RNF-05 (≤ 5 s)** en 3 de 5 corridas, ni la de "visible en
   la app ≤ 15 s" (detección + hasta 10 s de refresco). Las cotas salieron de
   CU-01/CU-02, donde la alerta la emite Wazuh.
3. **La acción es la más rápida de los tres casos** (0,10 s): mover los
   correos por IMAP en dos buzones, contra ~0,2 s de la API de Wazuh.
4. **Decisión tomada a partir del resultado (18/10):** se descartó acotar
   RNF-05 a las alertas de Wazuh (hubiera sido aceptar el número en vez de
   mejorarlo) y se cambió el diseño: el orquestador pasa a enterarse de los
   reportes por **IMAP IDLE** (el servidor avisa en el momento en que llega un
   correo) y el chequeo periódico queda solo como respaldo cada 60 s. La
   medición después del cambio está en la sección 8.

### Limitaciones

- n = 5, un solo analista que esperaba el incidente; laboratorio con dos
  buzones.

## 8. CU-03 después del cambio a IMAP IDLE — 18/10/2026

### Método

Igual que la sección 7 (5 corridas: `send-phish` → cuarentena con step-up →
cierre como verdadero positivo), con el orquestador desplegado con IMAP IDLE
(PR #22, commit `ebd2754`; el log confirma "buzón de reportes por IMAP IDLE").

### Resultados

| Tiempo | Antes: chequeo cada 15 s (sección 7) | **Después: IMAP IDLE** | Cota |
|---|---|---|---|
| Detección → ingesta | p50 6,82 s · p95 11,83 s | p50 **0,84 s** · p95 **1,29 s** (mín. 0,55 s) | ≤ 5 s |
| Ejecución de la acción | p50 0,10 s · p95 0,11 s | p50 **0,10 s** · p95 **0,11 s** | ≤ 2 s |
| Decisión del analista | p50 16,98 s · p95 31,88 s | p50 **11,64 s** · p95 **19,47 s** | — |
| Contención total | p50 25,37 s · p95 35,71 s | p50 **12,50 s** · p95 **20,02 s** | ≤ 60 s |

| Incidente | Detección → ingesta | Decisión | Acción | Contención |
|---|---|---|---|---|
| #1373 | 0,86 s | 11,64 s | 0,11 s | 12,50 s |
| #1374 | 0,84 s | 12,89 s | 0,10 s | 13,73 s |
| #1375 | 1,29 s | 11,03 s | 0,11 s | 12,31 s |
| #1376 | 0,55 s | 19,47 s | 0,10 s | 20,02 s |
| #1377 | 0,67 s | 10,33 s | 0,10 s | 11,00 s |

### Lectura

1. **La detección bajó 8 veces en la mediana (6,82 s → 0,84 s) y 9 veces en el
   p95 (11,83 s → 1,29 s).** Las 5 corridas cumplen la cota de RNF-05 (≤ 5 s),
   que antes fallaba en 3 de 5; también "visible en la app ≤ 15 s" (1,29 s +
   hasta 10 s de refresco). CU-03 queda en el mismo orden de detección que
   CU-01 y CU-02 (~1,3 s), que reciben la alerta empujada por Wazuh.
2. **La contención total bajó a la mitad** (25,37 s → 12,50 s de mediana).
   Parte es la detección; la otra parte es la decisión del analista (16,98 s
   → 11,64 s), que **no se debe atribuir al cambio**: es la misma persona
   repitiendo el mismo flujo (efecto de práctica) y la espera variable del
   refresco de la app.
3. **Ciclo completo:** medición → incumplimiento de una cota → cambio de
   diseño (sin relajar el requerimiento) → nueva medición que cumple.

### Limitaciones

- n = 5, un solo analista que conocía el flujo (afecta la decisión, no la
  detección ni la acción).
- IDLE depende de una conexión abierta: si se cae, la detección vuelve a
  depender del chequeo de respaldo (60 s) hasta que reconecta (1 s a 1 min).
