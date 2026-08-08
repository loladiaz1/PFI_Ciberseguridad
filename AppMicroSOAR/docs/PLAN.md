# PLAN.md — Micro-SOAR MVP (Demo de 5 minutos)

> Documento de trabajo vivo. Lo editamos a medida que avanzamos.
> Deadline de desarrollo: **18 de agosto de 2026**. Equipo: 2 personas.
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
- [ ] Wazuh detecta brute-force SSH (reglas nativas, cero desarrollo de reglas)
- [ ] Webhook Wazuh → orquestador
- [ ] Orquestador normaliza a `Incident` y persiste (PostgreSQL)
- [ ] App lista la alerta y muestra el detalle
- [ ] Botón "Bloquear IP" con step-up (biometría/PIN)
- [ ] Orquestador ejecuta el bloqueo vía API de Wazuh
- [ ] El bloqueo se ve (la conexión del atacante se corta en pantalla)
- [ ] Comunicación app↔orquestador por Tailscale (no IP pública)

### Entra si sobra tiempo (si no, va al video / a preguntas)
- [ ] Enriquecimiento VT/AbuseIPDB **cacheado** (respuesta precargada de la IP de ataque)
- [ ] Audit log visible en la app

### Fuera del MVP (trabajo futuro, para la defensa)
- Geo-context / impossible travel
- Módulo de IA / triaje ML
- Redis (instalado por el bootstrap, no integrado — "se activa al escalar")
- Four-Eyes, aislamiento de host, phishing
- Segundo escenario de PoC

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

### Fase 0 — Spike de riesgo (4–5 ago)
- [ ] (A) Terraform apply, Wazuh instalado
- [ ] (A) **Bloqueo de IP vía API de Wazuh desde curl** ← decide todo
- [ ] (B) Esqueleto app (login + lista vacía)
- [ ] (Ambos) Fijar contrato de API
- **Listo cuando:** desde curl logro que Wazuh dropee una IP.

### Fase 1 — Camino feliz backend (6–9 ago)
- [ ] Webhook recibe alerta de Wazuh, normaliza a `Incident`, persiste
- [ ] `GET /incidents` devuelve alertas reales
- [ ] `POST .../block-ip` bloquea de verdad
- **Listo cuando:** un brute-force real aparece por la API y un POST lo bloquea.

### Fase 2 — App consumiendo (8–12 ago, solapado)
- [ ] Login JWT
- [ ] Lista de alertas reales + detalle
- [ ] Botón de bloqueo (sin step-up todavía)
- **Listo cuando:** desde el celular veo la alerta y bloqueo, end-to-end por Tailscale.

### Fase 3 — Step-up + enriquecimiento (12–14 ago)
- [ ] Biometría/PIN antes de la acción crítica
- [ ] Enriquecimiento VT/AbuseIPDB cacheado
- [ ] Audit log
- **Listo cuando:** la acción pide biometría y la alerta muestra contexto de la IP.

### Fase 4 — Hardening y ensayo (15–18 ago)
- [ ] Instrumentar tiempos (timestamp alerta vs acción)
- [ ] Cerrar security groups, revisar exposición
- [ ] **Video de respaldo** del flujo completo
- [ ] **Ensayar 3× cronometrado** (< 5 min)
- **Listo cuando:** corro la demo entera en < 5 min sin salirme del guion.

### Colchón / plan de recorte
Si algo se atrasa, se recorta en este orden:
1. Enriquecimiento en vivo → al video
2. Audit log visible → a preguntas
3. Step-up es **irrenunciable** (es medio diferencial). No se recorta.

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

## 11. Definición de "demo exitosa"
- [ ] El bloqueo se ve (antes/después del atacante en pantalla)
- [ ] El step-up es real (biometría/PIN de verdad)
- [ ] El tráfico va por Tailscale (demostrable)
- [ ] Se muestra el número: segundos vs 8–14 min
- [ ] Corre en < 5 minutos
- [ ] Hay video de respaldo