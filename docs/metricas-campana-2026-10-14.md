# Campaña de medición de tiempos de respuesta — 14/10/2026

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
    biométrico: es el valor comparable con los 8-14 minutos del modelo de
    acceso remoto tradicional (VPN + consola).
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
2. **Frente a la línea de base de 8-14 minutos** (480-840 s), la contención
   mediana de 21,1 s es entre **23 y 40 veces menor**; tomando el peor caso
   medido (p95, 31,3 s), sigue siendo entre 15 y 27 veces menor, una
   reducción del **93,5 % al 96,3 %**.
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
  8-14 minutos del modelo de acceso remoto tradicional.

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
- La línea de base de 8-14 minutos proviene de la literatura citada en la
  tesis, no de una medición propia del modelo tradicional en este entorno.
