# PLAN.md — Micro-SOAR MVP (Demo de 5 minutos)

> Documento de trabajo vivo. Lo editamos a medida que avanzamos.
> Deadline de desarrollo: ~~18 de agosto de 2026~~ **1 de septiembre de
> 2026** (movido — la infra de AWS se destruyó por completo el 06/08 y hubo
> que reconstruir todo desde cero; detalle en `progress.md`, sesión 21/08).
> Equipo: 2 personas.
> Alcance: **Opción A recortada** (un solo flujo, contundente).

---

## 1. El MVP (lo único que la demo tiene que probar de nuestro proyecto)

Se puede bajar el tiempo de contención en guardia remota ejecutando el bloqueo
**desde el celular**, con step-up auth, sobre un canal Zero Trust (Tailscale),
usando open source. El número: **~segundos vs. 8–14 minutos** del flujo
tradicional (VPN + consola).

## 2. El "hilo dorado" (el flujo que se muestra en vivo)

```
Fuerza bruta SSH  →  Wazuh detecta  →  webhook  →  orquestador (normaliza + enriquece)
   →  push/lista en la app  →  analista toca "Bloquear IP"  →  step-up (biometría/PIN)
   →  orquestador → API de Wazuh → iptables  →  la conexión del atacante muere
```

Todo lo que no sostenga este flujo es secundario para la demo.

## 3. Guion de 5 minutos

| Tiempo | Qué |
|---|---|
| 0:00–0:30 | Problema: analista de guardia, 3am, latencia de acceso. Una frase. |
| 0:30–1:00 | Qué vamos a mostrar. Una frase. |
| 1:00–4:00 | **Flujo en vivo** (el hilo dorado). |
| 4:00–5:00 | El número (segundos vs 8–14 min) + cierre + una línea de "trabajo futuro". |

## 4. Alcance

### Entra (imprescindible)
- [x] Wazuh detecta brute-force SSH (reglas nativas, cero desarrollo de reglas)
- [x] Webhook Wazuh → orquestador
- [x] Orquestador normaliza a `Incident` y persiste (SQLite hoy; Postgres es cambiar `DATABASE_URL`, no urgente para la demo)
- [x] App lista la alerta y muestra el detalle
- [x] Botón "Bloquear IP" con step-up (biometría/PIN)
- [x] Orquestador ejecuta el bloqueo vía API de Wazuh
- [x] El bloqueo se ve (la conexión del atacante se corta en pantalla)
- [x] Comunicación app↔orquestador por Tailscale (no IP pública)

### Entra si sobra tiempo (si no, va al video / a preguntas)
- [x] Enriquecimiento VT/AbuseIPDB **cacheado** (02/10 — implementado y validado contra APIs reales; UI probada en celular contra infra real el 08/10)
- [x] Audit log visible en la app

### Fuera del MVP (trabajo futuro, para la defensa)
- Geo-context / impossible travel
- Módulo de IA / triaje ML
- Redis (instalado por el bootstrap, no integrado — "se activa al escalar")
- Four-Eyes, phishing
- ~~Aislamiento de host~~ (CU-02): **listo** — detección real (02/10) y aislamiento real desde el celular con step-up (08/10), ver `progress.md`. Falta solo un botón para revertir el aislamiento (hoy: reiniciar la víctima). Candidato a sumar a la demo

## 5. Arquitectura de la demo

**Híbrido.** Cloud para lo que prueba la tesis, local solo para desarrollar.

- **AWS (Terraform ya listo):** Wazuh (m7i-flex.large, RAM real para el
  all-in-one) + víctima (t3.micro) + orquestador (t3.small, pendiente),
  misma VPC / misma AZ, security groups cerrados, sin Elastic IP, sin NAT.
- **Víctima del brute-force:** VM Ubuntu dedicada (`aws_instance.victim` en
  `terraform/main.tf`), no el manager. El agente 000 (el propio manager)
  rechaza active-response (Wazuh error 1703), así que hace falta un agente
  real — de paso separa atacante → víctima → manager de forma más realista
  para la demo. El agente se instala y se registra solo en el boot (user_data)
  contra la IP privada del manager, misma VPC.
- **Atacante:** laptop propia con hydra o un loop de ssh. No es infra.
- **App:** celular físico (ideal, la biometría se ve real).
- **Overlay:** Tailscale en las dos instancias y el celular. La app habla con
  el orquestador por su IP 100.x.y.z.

### Por qué NO todo local
La tesis es *acceso remoto*. En localhost no se prueba movilidad. El celular
tiene que alcanzar el backend atravesando internet por Tailscale.

### Costos a vigilar
- Free Plan de AWS alcanza de sobra ($100–200 en créditos).
- **`stop` las instancias cuando no trabajamos** (único hábito que importa).
- Budget de alerta ya configurado en el Terraform.
- AMI de respaldo cuando el flujo funcione.

## 6. El eslabón crítico (probar PRIMERO)

```
tap en celular → orquestador → API de Wazuh → iptables → bloqueo real
```
Es lo que tiene más incógnita técnica. **Spike días 1–2:** lograr un bloqueo
vía API de Wazuh desde curl, a mano. Si funciona, hay demo. Si no:
- Plan B: el orquestador ejecuta el bloqueo por SSH en la instancia de Wazuh
  en vez de por la API.

## 7. Contrato de API (v1) — a fijar el día 1

Definir esto primero permite trabajar backend y app en paralelo.

```
POST /api/v1/webhook/wazuh      # ingreso de alertas desde Wazuh
GET  /api/v1/incidents          # lista de incidentes
GET  /api/v1/incidents/:id      # detalle
POST /api/v1/incidents/:id/actions/block-ip   # requiere step-up
POST /api/v1/auth/login         # devuelve JWT
GET  /api/v1/audit              # (opcional) log de acciones
```

Modelo `Incident` canónico (interno, NO la alerta cruda de Wazuh):
```
{
  id, source, ruleId, severity, srcIp, hostname,
  timestamp, status, enrichment: { virustotal, abuseipdb }, ...
}
```

## 8. Roadmap (4 → 18 ago)

> Fases solapadas a propósito: A=backend/infra, B=app Android.
> Criterio de "listo" = verificable, no "parece que anda".

### Fase 0 — Spike de riesgo (4–5 ago) — ✅ Listo
- [x] (A) Terraform apply, Wazuh instalado
- [x] (A) **Bloqueo de IP vía API de Wazuh desde curl** ← decide todo
- [x] (B) Esqueleto app (login + lista vacía)
- [x] (Ambos) Fijar contrato de API
- **Listo cuando:** desde curl logro que Wazuh dropee una IP.

### Fase 1 — Camino feliz backend (6–9 ago → cerrada 26/08) — ✅ Listo
- [x] Webhook recibe alerta de Wazuh, normaliza a `Incident`, persiste
- [x] `GET /incidents` devuelve alertas reales
- [x] `POST .../block-ip` bloquea de verdad
- **Listo cuando:** un brute-force real aparece por la API y un POST lo bloquea.
  Confirmado 26/08: un brute-force real crea el incidente solo, sin inyección manual.

### Fase 2 — App consumiendo (8–12 ago → cerrada 21/08) — ✅ Listo
- [x] Login JWT
- [x] Lista de alertas reales + detalle
- [x] Botón de bloqueo (con step-up ya incluido, ver Fase 3)
- **Listo cuando:** desde el celular veo la alerta y bloqueo, end-to-end por Tailscale.

### Fase 3 — Step-up + enriquecimiento (12–14 ago → cerrada 02/10) — ✅ Listo
- [x] Biometría/PIN antes de la acción crítica
- [x] Enriquecimiento VT/AbuseIPDB cacheado (backend validado; UI probada en celular el 08/10)
- [x] Audit log
- **Listo cuando:** la acción pide biometría y la alerta muestra contexto de la IP.
  Confirmado 02/10: enriquecimiento validado contra APIs reales (ver `progress.md`).

### Fase 4 — Hardening y ensayo (15–18 ago → extendido a 1 sep) — 🟡 En progreso
- [x] Instrumentar tiempos (timestamp alerta vs acción — `elapsedMs` en la app)
- [x] Cerrar security groups, revisar exposición (puerto 8000 confirmado no expuesto a internet)
- [x] Filtrar el ruido de alertas: solo los grupos de los casos de uso generan incidente, en el manager y en el orchestrator (13/10: 1335 → 15 incidentes reales)
- [x] UI sin destellos blancos al navegar (13/10)
- [ ] **Video de respaldo** del flujo completo
- [ ] **Ensayar 3× cronometrado** (< 5 min)
- **Listo cuando:** corro la demo entera en < 5 min sin salirme del guion.

### Colchón / plan de recorte
Si algo se atrasa, se recorta en este orden:
1. Enriquecimiento en vivo → al video
2. Audit log visible → a preguntas
3. Step-up es **irrenunciable** (es medio diferencial). No se recorta.

### CI/CD — deploy automático (agregado 05/10 → cerrado 13/10) — ✅ Listo
- [x] Workflows `ci.yml` (plan + tests en PRs) y `deploy.yml` (apply gateado + deploy SSM en push a `main`)
- [x] Roles OIDC (CI solo-lectura / deploy restringido a `main`) e instance profile SSM aplicados
- [x] State de Terraform reconstruido (`terraform import`) y AMI fijado
- [x] Bucket S3 del state creado (07/10, `micro-soar-tfstate-530390084140`, lock nativo `use_lockfile`, sin DynamoDB) y backend declarado en `versions.tf`
- [x] State local migrado al bucket (08/10)
- [x] `terraform apply` local: rol de deploy con lectura de IAM + acceso al bucket (08/10)
- [x] Workflows reciben las variables de Terraform por Secrets/Variables y fallan si falta el AMI fijo (07/10)
- [x] Variables y secrets cargados en GitHub (08/10)
- [x] ~~Environment `production`~~ descartado (13/10: requiere admin del repo). Reemplazo: el merge del PR es la aprobación humana + `deploy.yml` aborta solo si el plan destruye o reemplaza algún recurso
- [x] `~/orchestrator` migrado a clone de git en `/home/ubuntu/PFI_Ciberseguridad` (08/10; `.env` con `chmod 600`, pm2 `orchestrator` corriendo desde `orchestrator/`). La carpeta vieja `~/orchestrator` queda de respaldo hasta el primer deploy exitoso.
- [x] PR #2 a `main`: CI en verde, plan sin cambios de recursos, **primer deploy automático completo** (13/10)
- [ ] Mejora: que el deploy no falle si el orchestrator está apagado (hoy el job falla en "Buscar la instancia"; ver `progress.md`, 13/10)
- **Listo cuando:** un merge a `main` ~~pide aprobación~~ (el merge del PR es la aprobación), aplica Terraform sin reemplazar instancias, y deploya el orchestrator sin SSH. Cumplido 13/10.

### Calidad — tests y cobertura (agregado 13/10, pedido para la entrega del 20/10) — ✅ Listo
- [x] Cobertura del orchestrator > 85% en las 4 métricas: 98,9% líneas, 91,5% ramas, 96,9% funciones, 98,4% sentencias (49 tests)
- [x] Umbral de 85% obligatorio (`coverageThreshold`): el CI falla si baja; tabla en el resumen del run y reporte HTML como artefacto
- [x] Anexo para la tesis: `docs/anexo-pruebas/anexo-pruebas.pdf`, regenerable desde la corrida real de Jest
- [ ] Revisar el anexo antes del 20/10 (tono de los nombres de tests, carátula, numeración)
- Fuera de alcance por decisión del equipo: tests automatizados de la app móvil (se valida E2E en el celular)

### E75 — correcciones de la devolución E50 (entrega 20/10/2026) — 🟡 En progreso
Detalle completo en `CORRECCIONES para 75%.md`; registro en `progress.md` (sesión 14/10).

**Requisitos explícitos de E75**
- [ ] Resolución completa de las observaciones de E50 (ver abajo)
- [x] Evidencia de testing con cobertura ≥ 85% (`docs/anexo-pruebas/anexo-pruebas.pdf`, 13/10)
- [x] Marco legal y de privacidad: anonimización de datos y Ley 25.326 (14/10; base para la tesis en `docs/privacidad-ley-25326.md`)
- [ ] Capítulo de Conclusiones y Trabajo Futuro fundamentado con métricas (datos listos: contención p50 21,1 s / p95 31,3 s vs 8-14 min, ver `docs/metricas-campana-2026-10-14.md`)

**Correcciones técnicas del producto**
- [x] Instrumentar tiempos de respuesta por incidente + `GET /api/v1/metrics` (14/10, PR #7)
- [x] App con refresco automático cada 10 s (14/10, PR #8)
- [x] **Campaña de medición** (14/10): 6 corridas completas por caso de uso + 24 detecciones. Resultados en `docs/metricas-campana-2026-10-14.md`
- [x] Cotas numéricas propuestas a partir de la campaña — **crítica**: detección ≤ 5 s, visible en la app ≤ 15 s, ejecución de la acción ≤ 2 s, contención (SLA) ≤ 60 s, todas p95 (14/10)
- [ ] Incorporar las cotas al documento (RNF-05, RNF-07, precondiciones de CU-01/CU-02)
- [x] Eliminar cuenta (`DELETE /api/v1/me` + botón en Perfil, auditoría seudonimizada) — **crítica** (14/10)
- [x] Ley 25.326: retención con enmascarado de IPs a 90 días, aviso de privacidad en la app, consentimiento en el registro — **crítica** (14/10)
- [ ] Completar el responsable y contacto en `AppMicroSOAR/app/privacy.tsx` (placeholder) y programar la retención en la instancia
- [ ] Modelo de datos y contrato de API del documento = sistema real (no "versión objetivo")
- [ ] Diagramas vectoriales (arquitectura, flujos, secuencia, entidad-relación) — **crítica**
- [ ] Los 11 RNF redactados como "El sistema debe..." (junto con las cotas)

**Correcciones del documento** (formato, citas, estructura: títulos, carátulas, bibliografía, numeración, etc.)
- [ ] Pendientes. Migración del documento de Google Docs a LaTeX: pausada por ahora (varias correcciones de formato se resuelven solas con LaTeX)

## 9. Diseño para escalar (cuesta casi lo mismo ahora)
- Orquestador normaliza a `Incident` canónico (no propaga la alerta cruda).
- Acción de bloqueo detrás de una interfaz `Action` (patrón responders).
- Enriquecimiento detrás de una interfaz `Provider` (async + caché).
- API versionada `/api/v1`.
- JWT con claims/roles pensados para RBAC aunque hoy haya un solo rol.

## 10. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| API de Wazuh no dispara active-response desde afuera | Spike día 1; plan B por SSH |
| Rate limit de VT/AbuseIPDB en vivo | Respuestas cacheadas/precargadas |
| Conectividad falla en la presentación | Video de respaldo |
| FCM (push) come tiempo | Caer a polling con app abierta; el "buzz 3am" va al video |
| Algo se rompe cerca del 18 | AMI de respaldo para restaurar en minutos |
| Ruido de alertas tapa el ataque en la demo | Filtro por grupos de reglas en el manager y en el orchestrator (13/10) |
| Un deploy rompe o destruye infraestructura | PR con plan comentado + freno automático anti-destroy + tests con umbral de cobertura en CI |

## 11. Definición de "demo exitosa"
- [x] El bloqueo se ve (antes/después del atacante en pantalla)
- [x] El step-up es real (biometría/PIN de verdad)
- [x] El tráfico va por Tailscale (demostrable)
- [x] Se muestra el número: segundos vs 8–14 min (`elapsedMs` real en la pantalla de éxito)
- [ ] Corre en < 5 minutos (falta ensayar cronometrado)
- [ ] Hay video de respaldo