# Componente de aprendizaje automático — Fase 1 (validación sobre GUIDE)

Reporte de la fase 1 del recomendador de Fortia (Micro-SOAR): qué se hizo, con qué datos, qué cifras dio, qué
significan y qué no. Todas las cifras salen de `python -m fortia_ml.train` (salidas en `ml/out/`, no versionadas) y
son reproducibles con la semilla fija (ver *Reproducibilidad*).

## 1. Objetivo

Reducir el ruido de alertas conocidas sin perder ataques reales. El componente aprende la decisión del analista a
partir del caso y su contexto, y la usa de dos formas:

1. **Recomendación por incidente**: predice la disposición (`true_positive` / `benign_positive` / `false_positive`,
   la taxonomía de `orchestrator/src/closure.js`) con su confianza y las features que más pesaron.
2. **Políticas sugeridas**: agrupa casos por patrón y, si un patrón tiene al menos *N* casos y el analista decidió lo
   mismo en al menos *X* % de ellos, propone una política en el formato de
   `orchestrator/config/automation.defaults.json`. La política arranca deshabilitada y en simulación, la aprueba un
   admin, y siguen valiendo los controles actuales (activo crítico = solo manual, lista de exclusión, cortacircuitos).

El modelo nunca actúa solo. La métrica principal es la **precisión de lo que se propone automatizar**; el error
crítico es que una política "cerrar sin acción" absorba un verdadero positivo (un ataque real que nadie mira). Después
vienen la cobertura (% de incidentes que absorbe la automatización) y el macro-F1.

Esta fase **valida el método** sobre un dataset público. No produce el modelo de producción (ver §9).

## 2. Datos

**GUIDE** (Freitas et al., *AI-Driven Guided Response for Security Operation Centers with Microsoft Copilot for
Security*, arXiv:2407.09017v4; en la tesis, Freitas2025). Dataset de Kaggle *Microsoft Security Incident Prediction*:
`GUIDE_Train.csv` (2,4 GB) y `GUIDE_Test.csv` (1,1 GB). Telemetría real de Microsoft Defender XDR, anonimizada, con el
grado que asignó el analista del SOC de cada cliente.

**Licencia.** El paper declara que GUIDE se publica "under the permissive CDLA-2.0 license" (arXiv v4, p. 2): la
Community Data License Agreement – Permissive 2.0 permite usar, modificar y compartir los datos, incluido el uso
académico, con atribución. La página de Kaggle no se pudo leer en forma automática: **conviene confirmar el campo
*License* en Kaggle antes de citarlo**.

| | Train | Test |
|---|---|---|
| Filas de evidencia | 9.516.837 | 4.147.992 |
| Incidentes (OrgId, IncidentId) | 730.778 | 303.220 |
| Incidentes con grado | 707.108 | 303.220 |
| Organizaciones (con grado) | 5.340 | 4.400 |
| BP / FP / TP | 49,0 / 30,4 / 20,6 % | 48,9 / 30,5 / 20,6 % |

- Granularidad: una fila por evidencia (IP, usuario, archivo…). Se agrega a nivel incidente (§3).
- Un incidente tiene siempre un único grado. En Train, 23.670 incidentes (3,2 %) no tienen grado y se descartan.
- Incidentes chicos: mediana 1 alerta, p90 2, p99 9.
- Organizaciones chicas: mediana 7 incidentes con grado; solo 1.867 tienen 20 o más.

**El split oficial no es temporal.** Está estratificado por grado, OrgId y DetectorId (arXiv v4, apéndice B, p. 10).
Ningún incidente aparece en ambos archivos, pero las fechas se superponen: solo en 269 de las 4.054 organizaciones
comunes Test empieza después de que termina Train. Por eso la evaluación principal de este reporte es **temporal**
(§7). Además, el paper aclara que se agregó ruido a los timestamps para anonimizar (apéndice C, p. 10): el orden
temporal es aproximado.

**Acciones.** `ActionGrouped` solo está en el 3,6 % de los incidentes de Train y el 0,38 % de Test (1.149
incidentes), casi todos `ContainAccount` (sin equivalente en Fortia). **Predecir la acción no es viable con GUIDE**;
solo se predice la disposición.

### Mapeo GUIDE ↔ Fortia

| GUIDE | Fortia (`schema.prisma`, `automation.js`) | Uso |
|---|---|---|
| `IncidentGrade` | `verdict` | Etiqueta. Misma taxonomía |
| `DetectorId` (8.428), `AlertTitle` | `ruleId` / `ruleIds` | Feature (codificada por objetivo) y clave de patrón |
| `Category` (20) | `useCase` (aprox.) | Feature |
| alertas por incidente | `alertCount` | Feature y clave de patrón |
| `EntityType` (33) | tipo de evidencia (IP → CU-01, archivo → CU-02, correo → CU-03) | Feature y clave de patrón |
| `SuspicionLevel`, `ThreatFamily` | reputación (`vtMalicious`, `hashPositives`), solo cualitativa | Feature (conteos) |
| `CountryCode` | país de AbuseIPDB | **No**: entero anonimizado; el valor 242 es el 92 % de las filas |
| — | `severity`, `Asset.criticality`, `abuseScore`, conteos de VT | GUIDE no los trae |
| `ActionGrouped/Granular` | `blockedAt` / `isolatedAt` / `quarantinedAt` | **Excluidas**: posteriores al triaje |
| `LastVerdict` | — | **Excluida** del modelo principal (§8) |
| IDs (`Id`, `AlertId`, `DeviceId`, `Sha256`, `IpAddress`…) | — | **Excluidos** (anonimizados; `AlertId` solo para contar) |

**Consecuencia: ninguna de las 6 condiciones de `failedConditions()` (`minSeverity`, `minAbuseScore`,
`minVtMalicious`, `minHashPositives`, `fromCountries`, `maxAssetCriticality`) se puede expresar con GUIDE.** Las
políticas sugeridas usan el mismo esqueleto pero con `conditions: {}` y el patrón en un bloque aparte,
`guideConditions` (§6).

## 3. Método

Código en `ml/fortia_ml/`:

| Módulo | Qué hace |
|---|---|
| `schema.py` | Esquema común a nivel incidente, independiente de la fuente. GUIDE hoy; Fortia y Opsgenie después |
| `guide.py` | Lectura por columnas (pyarrow), agregación evidencia → incidente, muestreo determinístico por organización |
| `features.py` | Conteos por incidente, categoría, entidad dominante y la regla codificada por objetivo (`TargetEncoder`), global y por organización |
| `baselines.py` | Clase mayoritaria y tabla (OrgId, DetectorId) → grado mayoritario |
| `evaluation.py` | Macro-F1, precisión y recall por clase, en total y por segmento |
| `policies.py` | Minería de patrones, políticas sugeridas, métricas por organización y entre organizaciones |
| `train.py` / `figures.py` | Pipeline completo y figuras |

- **Agregación.** Un incidente = (OrgId, IncidentId). Se calculan la primera y la última alerta, la cantidad de
  alertas, evidencias, detectores y categorías, la regla y la categoría de la primera alerta, conteos por tipo de
  entidad (12 tipos + "Other") y conteos de evidencia impactada, sospechosa, incriminada, con familia de malware,
  con técnica MITRE y con dirección antispam.
- **Modelo.** `HistGradientBoostingClassifier` de scikit-learn, con parámetros por defecto. Se eligió porque maneja
  nulos y categorías y entrena en minutos con 700.000 incidentes en una laptop. Sin aprendizaje profundo.
- **Regla.** 8.428 detectores no entran como one-hot. Entran como la tasa de cada veredicto para esa regla, global y
  dentro de la organización, con validación cruzada interna para no filtrar la etiqueta (`TargetEncoder`, 5 folds).
- **Explicación.** Cada predicción va con su probabilidad por clase y el valor del caso en las 5 features más
  importantes (importancia por permutación sobre 20.000 incidentes; ejemplos en `ml/ejemplos/explicaciones.json`). Es importancia
  global, no una atribución local exacta (no se usó SHAP).
- **Políticas.** Patrón = (regla de la primera alerta, entidad dominante, tamaño: 1, 2-5 o 6+ alertas). La decisión es
  binaria: `requires_action` (TP) o `no_action` (BP + FP). Dos alcances: **por organización** (cada SOC mina sus casos;
  así se despliega Fortia, por cliente) y **entre organizaciones** (un MSSP que ve muchos clientes). Grilla
  N ∈ {5, 10, 20, 50, 100} × X ∈ {80, 90, 95, 99 %}.

## 4. Líneas de base

| Predictor | Qué es |
|---|---|
| Mayoritaria | Siempre `benign_positive` |
| Tabla | (OrgId, DetectorId) → grado mayoritario; si el par no se vio, DetectorId → mayoritario; si tampoco, la mayoritaria. Se calcula solo con el conjunto de entrenamiento (en la temporal, solo con el pasado de cada org) |
| Paper (CGR) | Random forest sobre one-hot + PCA, con split propio 70/10/20 por región. Tabla 2, p. 7 (arXiv v4): **Región 2 (la de GUIDE): precisión 0,92, recall 0,90, macro-F1 0,91**; promedio de 12 regiones: 0,87 / 0,86 / 0,87 |

**La cifra del paper no es directamente comparable.** Es su split interno sobre la Región 2 completa, no
`GUIDE_Test.csv`; el paper no publica resultados sobre el test de Kaggle. La paginación es la de arXiv v4: no se
pudo confirmar la Tabla 2 ni su página en la versión publicada (WWW '25 Companion, pp. 191-200). **Hay que verificarla
en esa versión o citar arXiv v4.** En el paper, con un umbral de precisión de 0,9 en producción, el modelo de triaje
cubre el 41 % de los incidentes (p. 8).

## 5. Resultados del modelo

### 5.1 Evaluación temporal (principal)

Dentro de cada organización, el primer 70 % de sus incidentes (Train + Test, por la primera alerta) entrena y el 30 %
restante evalúa: 704.460 / 305.868 incidentes.

| Predictor | Macro-F1 | Macro-precisión | Macro-recall |
|---|---|---|---|
| Mayoritaria | 0,219 | 0,163 | 0,333 |
| Tabla | 0,912 | 0,918 | 0,907 |
| **Modelo** | **0,915** | **0,921** | **0,911** |

Por clase (precisión / recall / F1):

| Clase | Tabla | Modelo |
|---|---|---|
| true_positive | 0,901 / 0,855 / 0,877 | 0,899 / 0,866 / 0,882 |
| benign_positive | 0,929 / 0,962 / 0,945 | 0,930 / 0,963 / 0,947 |
| false_positive | 0,924 / 0,902 / 0,913 | 0,933 / 0,902 / 0,917 |

Matriz de confusión del modelo: `out/confusion_matrix.png`. El 86,6 % de los TP se clasifica bien. El 8,2 % se
confunde con BP y el 5,1 % con FP. Esa confusión es la que más importa, porque es un ataque que se trataría como
ruido.

### 5.2 Split oficial de GUIDE

| Predictor | Macro-F1 | Macro-precisión | Macro-recall |
|---|---|---|---|
| Mayoritaria | 0,219 | 0,163 | 0,333 |
| Tabla | 0,928 | 0,934 | 0,923 |
| Modelo | 0,932 | 0,938 | 0,928 |

**El 0,928 de la tabla se explica por el split.** Como está estratificado por OrgId y DetectorId, el 98,3 % de los
incidentes de Test tiene un par (org, regla) ya visto en Train. En ese escenario, "esta regla, en este cliente, casi
siempre se cierra igual" alcanza.

### 5.3 Importancia de features (evaluación temporal)

Caída del macro-F1 al permutar cada feature: la tasa de veredicto de la regla **dentro de la organización** domina
(BP 0,182; TP 0,166; FP 0,088). Le siguen, muy lejos, la presencia de sesiones de inicio de sesión en la nube
(0,005), la tasa global de la regla (≈ 0,002 por clase) y la cantidad de evidencias (0,001). Detalle completo en
`out/feature_importance.csv`.

**Lectura honesta: el modelo le gana a la tabla por muy poco** (+0,004 de macro-F1 en la temporal). Casi toda la
señal está en "qué hizo este SOC con esta regla antes". La sección siguiente muestra dónde aporta.

## 6. Segmentos: dónde aporta el modelo

Macro-F1 de la evaluación temporal (`out/segments.csv` tiene también precisión y recall por clase).

**Por historia de la regla:**

| Segmento | % del test | Mayoritaria | Tabla | Modelo |
|---|---|---|---|---|
| Par (org, regla) visto | 96,0 % | 0,220 | 0,927 | 0,931 |
| Regla vista, no en esta org | 3,3 % | 0,184 | 0,524 | **0,544** |
| Regla nueva | 0,7 % | 0,244 | 0,244 | **0,264** |

**Por tamaño de la org** (incidentes en el pasado):

| Incidentes de la org | % del test | Tabla | Modelo |
|---|---|---|---|
| 0 | 0,3 % | 0,538 | **0,571** |
| 1-19 | 2,6 % | 0,801 | **0,816** |
| 20-199 | 13,4 % | 0,854 | 0,858 |
| 200-1999 | 36,4 % | 0,891 | 0,893 |
| 2000+ | 47,3 % | 0,951 | 0,954 |

- Con historia (par visto, orgs grandes), la tabla y el modelo empatan en la práctica.
- **El modelo aporta donde falta historia**: regla vista solo en otras orgs (+0,020), org sin pasado (+0,033) y orgs
  chicas (+0,015). En "regla vista, no en esta org", el recall de TP sube de 0,275 a 0,389.
- **Sin historia, nadie predice bien.** Con una regla nueva, el macro-F1 es 0,26: el modelo solo acierta los BP. Con
  una regla vista solo en otras orgs, es 0,54. En esos casos la decisión tiene que seguir siendo del analista.

## 7. Políticas sugeridas

Precisión binaria: BP + FP = "no requiere acción". Las cifras completas de la grilla están en `out/policy_grid.csv`.
La figura `out/policy_tradeoff.png` muestra la cobertura de "cerrar sin acción" contra los TP absorbidos.

### 7.1 Evaluación temporal, N = 20 y X = 95 % (valores por defecto)

| | Por organización (SOC) | Entre organizaciones (MSSP) |
|---|---|---|
| Políticas | 3.561 (2.940 *no_action*) en 1.165 orgs | 1.097 (1.001 *no_action*) |
| Cobertura total | 70,3 % | 23,2 % |
| Precisión total | 99,5 % | 99,2 % |
| **Cerrar sin acción: cobertura** | **58,8 %** | **21,2 %** |
| **Cerrar sin acción: precisión** | **99,6 %** | **99,3 %** |
| **TP absorbidos** | **755 (1,26 % de todos los TP)** | **446 (0,74 %)** |
| Contener: cobertura / precisión | 11,5 % / 99,0 % | 2,1 % / 98,4 % |
| Cobertura por org: media / mediana | 12,6 % / 0 % | — |
| Precisión por org: media / p10 | 98,6 % / 99,3 % | — |

### 7.2 Grilla N × X, cerrar sin acción (evaluación temporal)

Cada celda muestra cobertura / TP absorbidos (en % de todos los TP).

**Por organización:**

| N \ X | 80 % | 90 % | 95 % | 99 % |
|---|---|---|---|---|
| 5 | 67,7 / 2,94 | 66,5 / 2,11 | 65,5 / 1,76 | 58,5 / 1,24 |
| 10 | 64,2 / 2,41 | 63,2 / 1,77 | 62,3 / 1,42 | 55,2 / 0,90 |
| 20 | 60,4 / 2,04 | 59,6 / 1,48 | 58,8 / 1,26 | 51,8 / 0,73 |
| 50 | 53,0 / 1,40 | 52,5 / 1,05 | 51,9 / 0,98 | 45,3 / 0,59 |
| 100 | 46,7 / 0,96 | 46,4 / 0,78 | 46,0 / 0,75 | 40,0 / 0,41 |

**Entre organizaciones (MSSP):**

| N \ X | 80 % | 90 % | 95 % | 99 % |
|---|---|---|---|---|
| 5 | 60,9 / 25,6 | 24,7 / 1,49 | 23,2 / 0,88 | 20,4 / 0,52 |
| 10 | 59,7 / 25,4 | 23,6 / 1,38 | 22,1 / 0,78 | 19,4 / 0,41 |
| 20 | 58,5 / 25,2 | 22,5 / 1,23 | 21,2 / 0,74 | 18,4 / 0,38 |
| 50 | 56,2 / 25,0 | 20,3 / 1,13 | 19,1 / 0,67 | 16,4 / 0,34 |
| 100 | 54,0 / 24,7 | 18,4 / 1,01 | 17,3 / 0,58 | 14,8 / 0,27 |

Lectura:

- **El ruido conocido es mucho y se puede absorber con muy pocos errores.** Con políticas por organización (N = 20,
  X = 95 %), el 58,8 % de los incidentes futuros se cerraría sin acción, con 99,6 % de precisión. El costo es el
  1,26 % de los ataques reales. Subir X a 99 % baja la cobertura a 51,8 % y la pérdida a 0,73 %.
- **Por organización rinde más que entre organizaciones**: casi el triple de cobertura con una tasa de TP absorbidos
  del mismo orden. La misma regla es ruido en un cliente y ataque en otro. Lo confirma la importancia de features
  (§5.3).
- **Entre organizaciones, X = 80 % es peligroso**: absorbe el 25 % de los TP. Pocos patrones muy grandes con 80-90 %
  de BP arrastran muchos ataques. Un MSSP necesita X ≥ 95 %.
- **El agregado lo dominan las orgs grandes.** La cobertura por org tiene mediana 0 %: la mayoría de las orgs de GUIDE
  no llega a N = 20 casos por patrón. Para una org chica, las políticas propias no alcanzan. Ahí entra el diseño
  híbrido (§10).
- **Las políticas "cerrar sin acción" no se pueden implementar hoy.** Son el 83 % de las políticas sugeridas
  (2.940 de 3.561), pero `automation.js` solo tiene `block-ip`, `isolate-host` y `quarantine-email`. Se reportan como
  hallazgo (`proposedAction: "close-as-benign"`).
- **Muchas políticas "contener" tampoco tienen acción en Fortia.** Cuando la entidad dominante es `User` o `Url`, no
  hay equivalente; GUIDE es mayormente de cuentas (`ContainAccount`). Se marcan con `finding`.
- En el split oficial (no temporal), con N = 20 y X = 95 %, las cifras son algo mejores: por org, 60,1 % de cobertura
  sin acción y 0,87 % de TP absorbidos; MSSP, 21,4 % y 0,28 %.

### 7.3 Ejemplo de salida

`ml/ejemplos/politicas_sugeridas_org.json` y `ml/ejemplos/politicas_sugeridas_global.json` traen las 10 políticas con
más soporte, minadas en `GUIDE_Train.csv` con N = 20 y X = 95 %. Fragmento:

```json
{
  "key": "guide-org-83-det-60-mailmessage-1",
  "name": "GUIDE org 83 · detector 60 · MailMessage · alertas 1 → no_action",
  "order": 1,
  "enabled": false,
  "useCase": null,
  "action": null,
  "conditions": {},
  "guideConditions": { "orgId": 83, "detectorId": "60", "dominantEntity": "MailMessage", "alerts": "1" },
  "evidence": { "support": 2126, "true_positive": 0, "benign_positive": 2126, "false_positive": 0, "agreement": 1.0 },
  "proposedAction": "close-as-benign",
  "finding": "Accion inexistente en automation.js (solo block-ip, isolate-host, quarantine-email)"
}
```

## 8. Corrida aparte con `LastVerdict` (cota superior)

La Tabla 4 del paper describe `LastVerdict` como "Final verdict of threat analysis" y no aclara si se completa antes o
después del triaje. Si fuera posterior, filtraría la respuesta. Por eso queda fuera del modelo principal. Se hizo una
única corrida que la incluye (conteos de `Malicious` / `Suspicious` / `NoThreatsFound` por incidente):

| Evaluación | Modelo principal | Con LastVerdict |
|---|---|---|
| Temporal | 0,9154 | 0,9152 |
| Split oficial | 0,9324 | 0,9324 |

**No cambia nada.** Las tres features quedan con importancia ≈ 0. Incluso si hubiera filtración, no explica los
resultados, y excluirla no le cuesta nada al modelo.

## 9. Limitaciones

1. **Un modelo entrenado en GUIDE valida el método; no es el modelo de producción.** Las features no son las de
   Wazuh: GUIDE no tiene severidad, criticidad del activo, `abuseScore` ni conteos de VirusTotal, y sus reglas son
   detectores de Defender XDR. Ninguna política minada en GUIDE se puede cargar tal cual en Fortia.
2. **La señal es casi toda "historia del SOC con esta regla".** Eso funciona porque el ruido es repetitivo, pero exige
   historia: con reglas nuevas, el macro-F1 es 0,26.
3. **El orden temporal es aproximado**: los timestamps tienen ruido agregado por anonimización y el período es corto
   (la mayoría de las orgs cubre unas semanas). Sí descarta el optimismo del split estratificado.
4. **Sesgo de etiquetado**: no todos los incidentes se gradúan (el paper lo menciona, p. 8). Un incidente sin grado
   no entra ni al entrenamiento ni a la evaluación.
5. **Los IDs y el país están anonimizados**: no se puede probar `fromCountries` ni ninguna condición por entidad.
6. **Hiperparámetros por defecto**: el modelo llegó al tope de 100 iteraciones. Más iteraciones podrían sumar algo de
   F1, pero no cambia la conclusión de §5.3 y §6.
7. **La explicación es importancia global** más el valor del caso. No es una atribución local exacta.
8. **Circularidad (para la fase 2)**: con datos de Fortia, hay que excluir del entrenamiento los casos que cerró la
   automatización (`automationDecision = "executed"`). Si no, el modelo aprende de sí mismo.

## 10. Propuesta para la fase 2

1. **Acción "cerrar como benigno/falso positivo" (primer ítem).** Es el objetivo central (reducir ruido conocido) y
   la parte de mayor impacto: 58,8 % de cobertura con 1,26 % de TP absorbidos por org (§7). Requiere una acción nueva
   en `automation.js` que cierre con veredicto y nota automática. Tiene que seguir los mismos controles: simulación
   primero, aprobación del admin, activo crítico = manual, cortacircuitos. Además conviene un **muestreo de auditoría**:
   que un % de los cierres automáticos igual lo revise un analista, para medir los TP absorbidos en producción.
2. **Diseño híbrido.**
   - *Con historia suficiente* (patrón con ≥ N casos y ≥ X % de acuerdo en esa org): **política auditable derivada de
     la tabla**. Regla explícita en el formato de `automation.defaults.json`, con su evidencia (soporte y acuerdo),
     en simulación hasta que la apruebe un admin. Es lo que mejor rinde (§6: tabla ≈ modelo con historia) y es
     explicable sin ML.
   - *Sin historia* (regla nueva en la org, org chica): **sugerencia del modelo con su confianza**, mostrada al
     analista en la app. Nunca ejecuta. Ahí el modelo le gana a la tabla (§6), aunque con F1 bajo, por eso solo sugiere.
3. **Entrenar con incidentes de Fortia** (adaptador en `schema.py`): veredicto de cierre, `ruleId`, `severity`,
   `alertCount`, `hashPositives`, enriquecimiento VT/AbuseIPDB y `Asset.criticality`. Así las condiciones mapean 1:1 a
   `failedConditions()`. Excluir `automationDecision = "executed"`.
4. **Cómo servir el modelo** (a decidir; no implementado):

   | Opción | Pros | Contras |
   |---|---|---|
   | **Reglas JSON** (políticas minadas → `automation.defaults.json` / tabla `AutomationPolicy`) | Sin dependencias nuevas; auditable; reutiliza el motor de `automation.js` y sus controles; cubre el caso "con historia" | No cubre el caso "sin historia"; el reentrenamiento es un proceso offline |
   | **Sidecar Python** (servicio HTTP interno con el modelo de scikit-learn) | Mismo código que el entrenamiento; cubre la sugerencia sin historia | Otro proceso para desplegar, monitorear y asegurar; latencia de red; la superficie de ataque crece |
   | **Exportar el modelo a Node** (ONNX + `onnxruntime-node`) | Un solo proceso; inferencia local | El `TargetEncoder` y las features hay que reimplementarlos en JS (riesgo de desalineación); dependencia nativa |

   Recomendación preliminar: reglas JSON para las políticas (casi toda la cobertura) y, si la sugerencia sin historia
   demuestra valor con datos de Fortia, un sidecar.
5. **Opsgenie / Sentinel / XSIAM / CrowdStrike**: solo si se aprueba. El esquema común (`schema.py`) ya permite sumarlo
   como otro adaptador.

## 11. Reproducibilidad y viabilidad técnica

- Semilla fija (`--seed 0`): `TargetEncoder` (StratifiedKFold con shuffle), `HistGradientBoostingClassifier`,
  muestreos e importancia por permutación. El corte temporal y el muestreo por organización son determinísticos.
  **Verificado:** dos corridas completas independientes dieron macro-F1, segmentos, grilla de políticas e importancia
  de features idénticos.
- Entorno: Python 3.14.7, pandas 3.0.6, NumPy 2.5.4, scikit-learn 1.9.1, matplotlib 3.11.2 (versiones fijadas en
  `ml/requirements.txt`). Se registran también en `out/metrics.json`.
- Hardware: laptop con Intel Core i5-1135G7 (4 núcleos / 8 hilos, 2,4 GHz), 7,7 GB de RAM y Windows 11 Home. Sin GPU.
- Tiempos de la evaluación temporal (704.460 incidentes de entrenamiento, 305.868 de evaluación):
  - Entrenamiento del modelo: 24,7 s.
  - Inferencia en lote: 9,5 µs por incidente.
  - Inferencia de a un incidente, como llegaría en Fortia: 9,6 ms.

  Los tiempos no incluyen la construcción de features. La corrida completa (dos evaluaciones, importancia y grilla de
  políticas) tarda unos 4 minutos con los incidentes ya agregados en caché. Agregar los 13,7 millones de filas de
  evidencia suma unos 1,5 minutos más. **Es viable en una laptop sin GPU**, y la inferencia es despreciable frente al
  tiempo de decisión del analista.
- Reproducción:

```
cd ml
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pytest
.venv\Scripts\python -m fortia_ml.train --data <carpeta con GUIDE_Train.csv y GUIDE_Test.csv>
.venv\Scripts\python -m fortia_ml.train --data <carpeta> --with-last-verdict
.venv\Scripts\python -m fortia_ml.figures
```
