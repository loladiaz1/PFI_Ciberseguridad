# Demo: el recomendador aprende de los cierres (ML, fase 2)

Qué demuestra: Fortia aprende de los veredictos de los analistas. Recomienda qué hacer con cada
incidente nuevo y, cuando un patrón se cerró siempre igual, un admin lo convierte en una política que
cierra sola el ruido conocido, con los mismos controles que la contención automática. Responde a RF-15 /
HU-11 ("recibir recomendaciones automáticas") y al criterio "tendencias en informática".

Código: `orchestrator/src/recommender.js` (modelo), `src/automation.js` (acción `close-no-action`),
`tests/recommender.test.js` (15 tests). Método y validación: `ml/RESULTADOS.md` (fase 1, sección 12).

## Escenario

- **Benigno recurrente:** un job de monitoreo con credenciales vencidas intenta entrar por SSH a la
  víctima desde la propia víctima (`127.0.0.1`). Wazuh lo detecta como fuerza bruta (regla 5712). La
  detección es correcta y la actividad es legítima: es un benigno positivo, el ruido típico de un SOC.
  Script: `demo-ml/1-job-monitoreo.ps1`.
- **Ataque real:** la fuerza bruta de siempre desde la notebook (`demo-cu01-02/1-fuerza-bruta.ps1`).

Las dos alertas tienen la misma regla. Por eso el modelo necesita el nivel "entidad" (la IP de
origen): con la regla sola no se distinguen.

## Preparación (unos 15 minutos, el día anterior o antes de entrar)

1. `demo-cu01-02/0-preparar.ps1` (prende wazuh, orquestador y víctima).
2. En la app, como admin, en **Automatización**:
   - Modo **Simulación**.
   - Sumar `127.0.0.1` a la **lista de exclusión** (que nada la bloquee nunca).
   - Revisar que "Fuerza bruta contra activo de criticidad baja" siga **deshabilitada**.
3. Historial: correr `1-job-monitoreo.ps1` **5 veces**. Después de cada corrida, abrir el incidente y
   cerrarlo como **benigno positivo** (nota: "Job de monitoreo con credenciales vencidas", etiqueta
   "Actividad autorizada"). Cerrar cada uno antes de la corrida siguiente: si no, las alertas se agrupan
   en el mismo incidente.
   - En las corridas 1 a 3 la tarjeta "Recomendación del modelo" todavía no conoce esa IP y usa el
     patrón general (regla 5712 + cantidad de alertas): dice **Requiere acción** si hay 3 o más ataques
     cerrados con ese mismo tamaño, o "todavía no hay casos parecidos" si no los hay. Las dos sirven
     para contar que el modelo empieza sin saber.
   - Desde la corrida 4 dice **Cerrar sin acción · 3 de 3 casos**, con el botón para cerrar con el
     veredicto sugerido. Conviene sacar captura de los dos estados: es la evidencia de que aprendió.
4. Tener al menos 3 ataques reales cerrados como verdadero positivo (los de los ensayos de CU-01 sirven).
5. **No** adoptar la política todavía: se adopta en vivo. Si quedó una política aprendida de un ensayo
   anterior, eliminarla (Automatización → la política → **Eliminar política**).

Los cierres de la preparación son decisiones reales del equipo sobre incidentes reales: el job es
legítimo y lo corremos nosotros. No hay datos sintéticos en la base.

## En vivo (unos 3 minutos)

| Tiempo | Qué se hace | Qué se dice |
|---|---|---|
| 0:00 | Correr `1-job-monitoreo.ps1`. Abrir el incidente nuevo. | "Este incidente ya lo vimos 5 veces. Fortia lo aprendió de nuestros cierres." |
| 0:20 | Señalar la tarjeta: *Cerrar sin acción · Benigno positivo · 5 de 5 casos (100 %) · historial propio de IP 127.0.0.1*. | "No es una regla escrita por nadie: sale de los veredictos de los analistas. Y dice en qué se basa." |
| 0:40 | Automatización → **Aprendizaje de los cierres**. Mostrar la evaluación con casos reales. | "Cada caso se evalúa solo con lo que se había cerrado antes: es la misma evaluación temporal que hicimos sobre un millón de incidentes de Microsoft." |
| 1:00 | En **Políticas sugeridas** (N = 5): *IP 127.0.0.1 · regla 5712 → cerrar sin acción*. **Adoptar** (huella). | "El modelo propone, un humano aprueba. La política nace deshabilitada." |
| 1:20 | Habilitarla (huella). Correr el job de nuevo. El incidente muestra *Simulación: cerraría el caso sin acción*. | "Primero en simulación: medimos su precisión con los cierres de los analistas antes de dejarla actuar." |
| 1:50 | Cerrar ese caso como benigno. Pasar el modo a **Activa** (huella). Correr el job otra vez. | |
| 2:10 | El incidente aparece **ya cerrado**: *Cerrado automáticamente como ruido conocido*, con la evidencia en la nota y la etiqueta "Cierre automático". | "Nadie tuvo que mirarlo. Ese es el tiempo del analista que recuperamos." |
| 2:30 | Correr `1-fuerza-bruta.ps1`. Abrir el incidente: *Requiere acción*, abierto. Bloquear como siempre. | "Misma regla, otra IP: el ataque real no se cierra. Si el historial de una IP dice ataque, ninguna política la cierra." |
| 2:50 | Volver el modo a **Simulación**. | |

## Las cifras para la diapositiva

- **Validación (fase 1, GUIDE: 1,01 M de incidentes reales con grado, 5.340 organizaciones en Train):** con políticas por
  organización (N = 20, X = 95 %), el 58,8 % de los incidentes futuros se habría cerrado sin acción con
  99,6 % de precisión; el costo es el 1,26 % de los ataques reales. Con N = 5 (el de la demo): 65,5 % de
  cobertura y 1,76 % de ataques absorbidos (`ml/RESULTADOS.md`, 7.2).
- **Por qué en producción va la tabla y no el gradient boosting:** con historia, empatan (macro-F1 0,927
  vs 0,931) y la tabla es auditable. El modelo solo gana donde no hay historia, y ahí su F1 (0,26-0,54)
  no alcanza para actuar (`ml/RESULTADOS.md`, 5.3 y 6).
- **En Fortia:** la evaluación de la pantalla de Automatización, con los casos reales del día de la demo.

## Preguntas probables del jurado

- **"¿Esto es machine learning o es contar?"** Es aprendizaje supervisado a partir de etiquetas humanas,
  con el modelo elegido por evidencia: en la fase 1 entrenamos un gradient boosting sobre un millón de
  incidentes, y la importancia por permutación mostró que casi toda la señal es la tasa de veredictos de
  la regla dentro del SOC (su feature principal). Servimos esa feature, que con historia rinde lo mismo
  (diferencia de 0,004 de macro-F1), es explicable para el analista y se actualiza sola con cada cierre.
  Y, como en el paper de GUIDE, se prioriza la precisión: solo se automatiza con umbrales altos.
- **"¿Y si cierra un ataque real?"** Seis frenos: (1) nada se cierra sin que un admin adopte la política,
  patrón por patrón; (2) primero en simulación, con la precisión medida; (3) si el patrón deja de cumplir
  N y X (alguien cerró uno como ataque), la política deja de aplicar sola; (4) si el historial propio de
  la entidad indica ataque, no se cierra por el patrón general; (5) activo crítico = solo manual, y
  cortacircuitos (que ahora también cuenta los cierres); (6) todo cierre automático queda auditado y se
  puede reabrir, y un caso reabierto por un analista no se vuelve a cerrar solo.
- **"¿El modelo no aprende de sí mismo?"** No: los casos que cerró la automatización no entran al
  historial (`ml/RESULTADOS.md`, limitación 8). Si un analista reabre uno y lo cierra, ese cierre sí cuenta.
- **"¿Un atacante puede aprovecharlo?"** Si compromete el host que genera el ruido conocido, sus alertas
  con esa misma regla e IP se cerrarían solas. Por eso el patrón es estrecho (regla + entidad), nace en
  simulación y el riesgo es el mismo que el de cualquier lista de exclusión. Trabajo futuro: muestreo de
  auditoría (que un analista revise un % de los cierres automáticos) y vencimiento de las políticas.
- **"¿Por qué 3 casos para recomendar y N = 5 en la demo?"** 3 es el mínimo para mostrar una sugerencia
  (solo sugiere, decide el analista). N para cerrar solo es configurable; la fase 1 midió la grilla de
  N = 5 a 100. En un SOC real usaríamos N = 20 o más.
- **"¿Qué pasa a los 90 días?"** La retención enmascara las IPs (Ley 25.326): el historial de entidad de
  esa IP deja de coincidir y queda solo el patrón general. Es una decisión a favor de la privacidad.

## Si algo falla en vivo

- Si el job no genera incidente: revisar que la víctima responde (`0-preparar.ps1`) y esperar 2-3 minutos
  a Wazuh. Mostrar las capturas de la preparación (los dos estados de la tarjeta).
- Si la política no aparece en sugeridas: el patrón necesita 5 cierres de benigno sin ningún verdadero
  positivo (acuerdo ≥ 95 %); la app no ofrece N menor que 5. Correr el job y cerrar los que falten, o
  usar las capturas.
- Probado: tests automatizados y una corrida local por HTTP del flujo completo (25/11). **Falta probar el
  script del job contra la víctima real**: hacerlo en el primer ensayo.
