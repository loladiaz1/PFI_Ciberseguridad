# Prueba local completa del recomendador (ML fase 2)

En la laptop, sin AWS. Las alertas las manda `demo-ml/simular-local.ps1` al webhook del orchestrator,
igual que lo haría Wazuh. Cada paso trae lo que se tiene que ver; si algo no coincide, anotarlo y seguir.

**Local se prueba:** recomendación, aprendizaje, evaluación, políticas sugeridas, adopción, simulación,
cierre automático, frenos de seguridad, roles y textos de la app.
**Local NO se prueba:** que Wazuh genere la alerta del job real, y bloquear o aislar de verdad (sin
Wazuh esas acciones fallan, y es lo esperado). Eso va en la sección 6.

Todos los comandos son de PowerShell, desde la raíz del repo.

## 1. Pruebas automáticas (5 minutos)

```powershell
cd orchestrator; npm ci; npm test; cd ..                  # 235 de 235
ml\.venv\Scripts\python -m pytest ml                      # 27 de 27 (venv ya creado)
cd AppMicroSOAR; npx expo lint; npx tsc --noEmit; cd ..   # lint: 0 errores (2 warnings viejos en modal.tsx)
```

`tsc` puede mostrar errores del tipo `Type '"/close"' is not assignable...` si las rutas tipadas de
expo-router están desactualizadas: desaparecen después de un `npx expo start`, que las regenera.

## 2. Levantar el orchestrator con una base nueva

Una base aparte (`local-ml.db`) para no tocar `soar.db`. Todo en **la misma ventana** de PowerShell
(las variables valen solo para esa ventana y le ganan al `.env`).

```powershell
cd orchestrator
npx prisma generate
$env:DATABASE_URL = "file:./local-ml.db"
npx prisma db push
$env:WAZUH_HOST = "https://wazuh.invalid:55000"   # que las acciones fallen rápido, sin tocar el Wazuh real
$env:ABUSEIPDB_API_KEY = "<tu clave>"            # opcional: para ver la reputación de 31.77.135.123 (paso P15)
npm start                                         # "Micro-SOAR Orchestrator escuchando en :8000"
```

- El admin es el `AUTH_USER` / `AUTH_PASSWORD` de `orchestrator/.env`.
- Si `prisma generate` da `EPERM`, hay otro orchestrator corriendo: cerrarlo.
- Para el script, en **otra** ventana: `$env:FORTIA_USER = "<AUTH_USER>"; $env:FORTIA_PASSWORD = "<AUTH_PASSWORD>"`.

## 3. Levantar la app

1. Anotar la línea actual de `AppMicroSOAR/.env` (para restaurarla al final) y cambiarla:
   - **Celular físico por Tailscale (recomendado):** `EXPO_PUBLIC_API_URL=http://<tailscale ip -4 de la laptop>:8000`.
     Funciona aunque la Wi-Fi aísle los dispositivos (pasó en la facultad).
   - **Celular en la misma Wi-Fi:** `http://<IPv4 de la laptop, ver ipconfig>:8000`.
   - **Emulador de Android:** `http://10.0.2.2:8000`.
2. Abrir el puerto 8000 en el firewall de Windows (PowerShell **como administrador**; no hace falta para
   el emulador):
   `New-NetFirewallRule -DisplayName "Fortia local 8000" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`
3. Comprobar desde el navegador del celular: `http://<ip>:8000/api/v1/closure-catalog` tiene que
   responder un JSON de error 401. Eso confirma que llega.
4. `cd AppMicroSOAR; npx expo start -c` (el `-c` limpia la caché: si no, la app puede seguir con la URL
   vieja) y escanear el QR con Expo Go.
5. El step-up necesita una huella o un rostro registrados en el dispositivo. En el emulador: registrar una
   huella en Ajustes y, cuando la pida, `adb -e emu finger touch 1`.
6. Entrar con el admin.

## 4. Casos de prueba

Para crear alertas: `demo-ml\simular-local.ps1 -Tipo job` (job de monitoreo, 127.0.0.1) o `-Tipo ataque`
(fuerza bruta desde 31.77.135.123). Cada corrida abre un incidente nuevo **si el anterior ya está
cerrado**; si no, la alerta se suma al abierto ("sumada al incidente"). Los números esperados suponen
que se sigue el orden exacto.

### A. El modelo aprende

| # | Qué hacer | Qué se tiene que ver |
|---|---|---|
| P1 | `-Tipo ataque` y abrir el incidente. | Tarjeta **Recomendación del modelo**: "Todavía no hay casos parecidos cerrados...". |
| P2 | Cerrarlo como verdadero positivo. Después, `.\simular-local.ps1 -Tipo ataque -Historial 2`. | Quedan 3 ataques cerrados. |
| P3 | `-Tipo job` y abrir el incidente. | **Requiere acción · Verdadero positivo**. "3 de 3 casos parecidos (100 %) fueron ataques reales". "Basado en: regla 5712 · 1 alerta (patrón general)". Sin botón de cierre sugerido. |
| P4 | **Cerrar caso** → Benigno positivo, nota "Job de monitoreo con credenciales vencidas". Otro `-Tipo job`. | Requiere acción, "3 de 4 (75 %)" y en naranja "Historial mixto: la decisión es del analista". |
| P5 | Cerrarlo como benigno. Otro `-Tipo job`. | Requiere acción, "3 de 5 (60 %)", historial mixto. |
| P6 | Cerrarlo como benigno. Otro `-Tipo job`. | Cambia a **Cerrar sin acción · Benigno positivo**. "3 de 3 casos parecidos (100 %) se cerraron sin acción". "Basado en: IP 127.0.0.1 · regla 5712 (historial propio)". Botón **Cerrar como benigno positivo**. |
| P7 | Tocar el botón. | Pantalla de cierre con **Benigno positivo ya elegido** y la nota prellenada ("Según el historial, 3 de 3 casos..."). Confirmar → caso cerrado. |
| P8 | Otro `-Tipo job` y cerrarlo con el botón. | "4 de 4". Ya hay 5 cierres del job. |

### B. Evaluación y políticas sugeridas

| # | Qué hacer | Qué se tiene que ver |
|---|---|---|
| P9 | Perfil → **Automatización** → **Aprendizaje de los cierres**. | Evaluación: "8 casos cerrados por analistas", "Recomendó en 5 (63 %)", "Acertó 2 (40 %)", "Con las políticas sugeridas: 0 cierres automáticos (- de precisión), 0 ataque(s)...". Abajo, las cifras de GUIDE. (El acierto es bajo a propósito: P3 a P5 fueron errores del patrón general. Hay 0 cierres porque ningún caso tenía todavía 5 cierres previos de su patrón.) |
| P10 | En **Políticas sugeridas**, con N = 5. | Una sola: "IP 127.0.0.1 · regla 5712 → Cerrar sin acción", "CU-01 · 5 casos · 5 BP · 0 FP · 0 VP · 100 %". El patrón general (3 VP de 8) no aparece. |
| P11 | Tocar N = 10. | "Ningún patrón cumple hoy los umbrales." Volver a N = 5. |
| P12 | **Adoptar como política** → huella. | Aviso "Política creada". En **Políticas**, al final: "Aprendida: IP 127.0.0.1 · regla 5712 → cerrar sin acción", "CU-01 · Cerrar sin acción", **deshabilitada**, con "Casos del patrón (N) ≥ 5", "Acuerdo (X...) ≥ 0.95" y "Criticidad del activo ≤ media". La sugerencia pasa a "Ya es una política". En Actividad → Automatización: "Política aprendida ... (deshabilitada): 5 de 5 casos sin acción, acuerdo 100 %; N 5, X 95 %". |

### C. Simulación y cierre automático

| # | Qué hacer | Qué se tiene que ver |
|---|---|---|
| P13 | Habilitar la política (switch + huella). El modo sigue en **Simulación**. `-Tipo job`. | Incidente abierto, tarjeta naranja **"Simulación: cerraría el caso sin acción"** y "Política: Aprendida: ...". En su registro de auditoría: "Simulación: cierre sin acción en el incidente #N...". Cerrarlo con el botón del modelo. |
| P14 | Modo → **Activa** (confirmar + huella). `-Tipo job`. | El incidente aparece **ya cerrado**: tarjeta verde "Cerrado automáticamente como ruido conocido", "Caso cerrado · Benigno positivo · por automation", nota "Cierre automático: 6 de 6 casos de este patrón se cerraron sin acción (...)", etiquetas "Fuerza bruta" y "Cierre automático". No figura en "por atender" del dashboard. En Automatización, bajo la política: "Cerrados automáticamente: 1 · cerrados 0" y "Simulados: 1 · cerrados 1 · precisión 100 % (0 VP · 1 BP · 0 FP)". |

### D. Frenos de seguridad

| # | Qué hacer | Qué se tiene que ver |
|---|---|---|
| P15 | `-Tipo ataque` (sigue en Activa). | Recomendación **Requiere acción**, "3 de 3... fueron ataques reales", "IP 31.77.135.123 · regla 5712 (historial propio)". **No** se cierra. Con la clave de AbuseIPDB: "Inteligencia de amenazas" muestra el puntaje, y si es ≥ 80 la política de mala reputación intenta bloquear → localmente "Falló la respuesta automática" (no hay Wazuh: es lo esperado; en Simulación diría "bloquearía esta IP"). Cerrarlo como verdadero positivo. |
| P16 | Límites de seguridad → máximo de acciones **1** → Guardar. `-Tipo job`. | Si pasaron menos de 10 minutos desde P14: no se cierra, "Simulación: cerraría..." y el modo pasa solo a **Simulación** con el aviso "Pausada automáticamente por el cortacircuitos". Si pasaron más de 10 minutos, este se cierra solo y el **siguiente** `-Tipo job` es el que dispara el cortacircuitos. Volver el máximo a **5**, el modo a **Activa**, y cerrar ese caso con el botón. |
| P17 | En la política aprendida, **Editar umbrales** → N = 50 → Guardar. `-Tipo job`. | No se cierra. El motivo de la automatización dice "historial 7 < 50 casos". Volver N a 5. Probar también el acuerdo en `0.3`: "Cambio no guardado". Cerrar el caso con el botón. |
| P18 | `-Tipo job` → se cierra solo. Abrirlo → **Reabrir caso** con nota. **Antes de 10 minutos**, otro `-Tipo job`. | El script dice "sumada al incidente #N" y el caso **sigue abierto**: un caso reabierto no se vuelve a cerrar solo. |
| P18b | Lo mismo, pero con un caso que cerraste **vos**: deshabilitar la política, `-Tipo job`, cerrarlo como benigno, volver a habilitar la política, reabrir el caso y, antes de 10 minutos, otro `-Tipo job`. | La alerta se suma al caso, que **sigue abierto**, con el motivo "Caso reabierto por un analista: las políticas aprendidas no lo cierran". (Antes del 25/11 se cerraba solo: lo encontró esta prueba.) |
| P19 | Cerrar ese caso como **Verdadero positivo** (el analista corrige al modelo). `-Tipo job`. | Ya no se cierra solo. El motivo dice "...acuerdo 89 % < 95 %" y la recomendación baja a "8 de 9 (89 %)". Un solo ataque en el historial apaga la política. |
| P19b | En la política aprendida, **Eliminar política** → confirmar → huella. | Desaparece de la lista; en Políticas sugeridas el patrón vuelve a mostrar "Adoptar como política". En Actividad → Automatización: "Política aprendida ... eliminada (estaba habilitada; condiciones ...)". Los incidentes que había cerrado siguen mostrando "Cerrado automáticamente como ruido conocido". Las políticas iniciales no tienen el botón. |

### E. Roles (opcional, 5 minutos)

| # | Qué hacer | Qué se tiene que ver |
|---|---|---|
| P20 | Cerrar sesión → registrar un usuario nuevo → como admin, en Usuarios, aprobarlo como **Analista** → entrar con ese usuario. | En Automatización: "Solo lectura..." y sin "Adoptar como política". En un incidente del job ve la recomendación y el botón para cerrar. |
| P21 | Cambiarle el rol a **Auditor**. | Ve la recomendación, pero sin botones de acción ni de cierre. |

Al terminar: modo **Simulación** (que no quede en Activa en la base local).

## 5. Limpieza

1. Ctrl+C en la ventana del orchestrator; borrar `orchestrator\prisma\local-ml.db`.
2. Restaurar la línea original de `AppMicroSOAR/.env` y reiniciar Expo con `-c`.
3. `Remove-NetFirewallRule -DisplayName "Fortia local 8000"` (como administrador).

## 6. Lo que queda para AWS (después del merge, que deploya solo)

No hay cambios de esquema de base: el deploy (`prisma db push`) no toca datos.

1. Prender las instancias: `demo-cu01-02\0-preparar.ps1`.
2. `demo-ml\1-job-monitoreo.ps1` y confirmar que llega un incidente CU-01 desde **127.0.0.1**. Es lo único
   del flujo que todavía no se probó contra la infraestructura real. Si no aparece: el filtro de Wazuh
   y el del orchestrator solo dejan pasar el grupo `authentication_failures` (regla 5712).
3. Seguir la preparación y el guion de `demo-ml/GUION.md`. Ahí sí se bloquea de verdad el ataque real.
