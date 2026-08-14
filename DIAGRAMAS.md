<!-- title: Micro-SOAR — Diagramas de Arquitectura -->

# Micro-SOAR — Diagramas de Arquitectura

Los cuatro diagramas que pediste, en Mermaid, armados a partir del código real del repo (`orchestrator/`, `AppMicroSOAR/`, `terraform/`) y de `PLAN.md`, no de una plantilla genérica. Cada sección tiene el código para copiar y una nota corta de qué decisión de diseño encierra.

| # | Diagrama | Responde a |
|---|---|---|
| 1 | Arquitectura de despliegue | ¿Dónde vive cada componente y cómo se hablan? |
| 2 | Secuencia | ¿Qué pasa, en orden, desde el ataque hasta el bloqueo? |
| 3 | Casos de uso | ¿Qué dispara el analista a mano vs. qué resuelve el sistema solo? |
| 4 | Entidad-Relación | ¿Cómo es la base hoy, y cómo escala si sobra tiempo? |

---

## 1. Arquitectura de despliegue (alto nivel)

```mermaid
flowchart TB
  Attacker(["💻 Atacante<br/>laptop, hydra / loop ssh"])
  Phone(["📱 AppMicroSOAR<br/>Expo / React Native<br/>nodo Tailscale"])

  subgraph VPC["AWS VPC · us-east-1 · misma AZ, security groups cerrados"]
    direction LR
    Victim["🖥️ EC2 víctima<br/>sshd + wazuh-agent"]
    Wazuh["🛡️ EC2 Wazuh Manager<br/>manager + indexer + dashboard"]
    Orchestrator["⚙️ EC2 orchestrator (t3.small)<br/>Node/Express + Prisma/SQLite<br/>nodo Tailscale · sin puerto público"]
  end

  Attacker -->|"fuerza bruta SSH :22"| Victim
  Victim -->|"eventos de auth<br/>agente :1514/:1515"| Wazuh
  Wazuh -->|"custom-microsoar<br/>POST /api/v1/webhook/wazuh"| Orchestrator
  Orchestrator -->|"PUT /active-response<br/>API :55000 (SG: solo desde VPC)"| Wazuh
  Wazuh -->|"active-response<br/>firewall-drop"| Victim
  Phone -.->|"HTTPS + JWT<br/>túnel Tailscale 100.x.y.z<br/>(sin regla de SG abierta)"| Orchestrator
```

**Qué decisión encierra este dibujo:** la flecha punteada del celular al orchestrator es la única forma de llegar a la API — no hay ningún puerto 8000 abierto en el security group (ver `terraform/main.tf`, `aws_security_group.orchestrator`), ni siquiera a tu IP. Ese es el argumento Zero Trust de la tesis: el backend del SOAR nunca está expuesto a `0.0.0.0/0`, solo es alcanzable dentro de la tailnet cifrada. La única flecha "abierta al mundo" es la del atacante contra la víctima, que es justamente la que se quiere cortar.

*Fuente: `terraform/main.tf` (security groups), `orchestrator/integrations/custom-microsoar.py` (webhook), `orchestrator/src/wazuh.js` (llamada a la API de Wazuh).*

---

## 2. Secuencia (el core business)

```mermaid
sequenceDiagram
    actor Attacker as 💻 Atacante
    participant Victim as 🖥️ Víctima (sshd + wazuh-agent)
    participant Wazuh as 🛡️ Wazuh Manager
    participant Orchestrator as ⚙️ Orchestrator API
    participant DB as 🗄️ SQLite (Prisma)
    actor Analyst as 👤 Analista SOC
    participant App as 📱 AppMicroSOAR

    Attacker->>Victim: intentos SSH fallidos (brute force)
    Victim->>Wazuh: reenvía logs de auth (agente :1514)
    Note over Wazuh: regla nativa 5712 dispara (level 10)
    Wazuh->>Orchestrator: custom-microsoar → POST /api/v1/webhook/wazuh
    Orchestrator->>Orchestrator: normalizeWazuhAlert()
    Orchestrator->>DB: INSERT incidente (status = new)
    DB-->>Orchestrator: incident #id
    Orchestrator-->>Wazuh: 201 Created

    Analyst->>App: abre la app
    App->>Orchestrator: POST /api/v1/auth/login
    Orchestrator-->>App: 200 { token JWT }
    App->>Orchestrator: GET /api/v1/incidents (Bearer)
    Orchestrator->>DB: SELECT incidentes
    DB-->>Orchestrator: lista
    Orchestrator-->>App: 200 [ ...incidentes ]

    Analyst->>App: toca "Bloquear IP"
    App->>Analyst: pide Face ID / huella (step-up local)
    Analyst-->>App: biometría OK
    App->>Orchestrator: POST /incidents/:id/actions/block-ip (Bearer)
    Orchestrator->>Wazuh: GET /security/user/authenticate
    Wazuh-->>Orchestrator: token Wazuh
    Orchestrator->>Wazuh: PUT /active-response { agentId, srcIp }
    Wazuh->>Victim: comando firewall-drop
    Victim->>Victim: iptables DROP srcIp
    Wazuh-->>Orchestrator: 200 (comando aceptado)
    Orchestrator->>DB: UPDATE status = blocked, blockedAt = now()
    Orchestrator-->>App: 200 { srcIp, agentId, status: blocked }
    App-->>Analyst: pantalla Success (segundos transcurridos)
    Attacker--xVictim: conexión cortada
```

**Qué decisión encierra este dibujo:** el step-up biométrico (`App→Analyst→App`) pasa *antes* de la llamada de red al orchestrator, no después — es local al dispositivo, no un segundo POST. Y el tiempo que se muestra en "Success" (ver `AppMicroSOAR/app/loading.tsx`) se mide justo entre el POST de bloqueo y la respuesta 200: es el número real que reemplaza a los 8–14 minutos del flujo tradicional.

*Fuente: `orchestrator/src/app.js`, `orchestrator/src/normalize.js`, `orchestrator/src/wazuh.js`, `AppMicroSOAR/app/{index,auth,confirm,loading,success}.tsx`.*

---

## 3. Casos de uso

Mermaid no tiene un tipo de diagrama UML de casos de uso nativo (sin actores "monigote" ni óvalos reales), así que esta versión lo aproxima con un flowchart. Si tu entrega necesita la notación UML formal, más abajo dejo el mismo diagrama en PlantUML, que sí soporta `usecase` y `actor` de verdad.

### Versión Mermaid (aproximada)

```mermaid
flowchart LR
  Analyst(["👤 Analista SOC<br/>(celular)"])
  WazuhSys(["🛡️ Wazuh Manager<br/>(sistema)"])

  subgraph MicroSOAR["Sistema Micro-SOAR"]
    direction TB
    UC1(("Iniciar sesión"))
    UC2(("Ver lista de<br/>incidentes"))
    UC3(("Ver detalle de<br/>incidente"))
    UC4(("Bloquear IP<br/>+ step-up biométrico"))
    UC5(("Detectar fuerza<br/>bruta SSH"))
    UC6(("Normalizar y<br/>persistir incidente"))
  end

  Analyst --- UC1
  Analyst --- UC2
  Analyst --- UC3
  Analyst --- UC4
  WazuhSys --- UC5
  WazuhSys --- UC6
  UC6 -.->|"habilita"| UC2

  style UC4 fill:#e05d44,stroke:#e05d44,color:#fff
```

**Qué decisión encierra este dibujo:** solo hay **un** caso de uso crítico que el analista dispara a mano — bloquear la IP, resaltado en el diagrama — y va con step-up biométrico porque el PLAN lo marca como irrenunciable. Todo lo que pasa *antes* (detectar, normalizar, persistir) es 100% automático y no depende de que nadie mire el celular. Esa línea (manual vs. automático) es exactamente el corte de alcance del MVP.

### Versión PlantUML (notación UML formal)

```plantuml
@startuml
left to right direction
actor "Analista SOC" as Analyst
actor "Wazuh Manager" as Wazuh

rectangle "Micro-SOAR" {
  usecase "Iniciar sesión" as UC1
  usecase "Ver lista de incidentes" as UC2
  usecase "Ver detalle de incidente" as UC3
  usecase "Bloquear IP\n(step-up biométrico)" as UC4
  usecase "Detectar fuerza bruta SSH" as UC5
  usecase "Normalizar y persistir incidente" as UC6
}

Analyst --> UC1
Analyst --> UC2
Analyst --> UC3
Analyst --> UC4
Wazuh --> UC5
Wazuh --> UC6
UC6 ..> UC2 : <<include>>
@enduml
```

*Fuente: `PLAN.md` secciones 1 y 4 (alcance del MVP), `AppMicroSOAR/app/auth.tsx` (step-up real con `expo-local-authentication`).*

---

## 4. Modelo Entidad-Relación (DER)

Ojo con este: hoy la base **no** tiene tablas separadas de alertas, reglas de bloqueo y auditoría — todo vive en una sola tabla `incidents` (ver `orchestrator/prisma/schema.prisma`). Te dejo las dos versiones para que no la tesis no diga algo que el código no hace:

### DER actual (lo que está implementado)

```mermaid
erDiagram
  INCIDENT {
    int id PK
    string source
    string ruleId
    int severity
    string srcIp
    string hostname
    string agentId
    string timestamp
    string status "new | blocked"
    datetime blockedAt "nullable"
  }
```

Una sola entidad: el orchestrator normaliza la alerta cruda de Wazuh directamente a `Incident` y la persiste ahí (`normalizeWazuhAlert()`), sin guardar la alerta original ni un log de auditoría separado.

### DER extendido (roadmap — PLAN.md sección 9, no implementado)

```mermaid
erDiagram
  ALERT ||--o{ INCIDENT : "se normaliza a"
  INCIDENT ||--o{ BLOCK_ACTION : "dispara"
  INCIDENT ||--o{ AUDIT_LOG : "registra"

  ALERT {
    int id PK
    string ruleId
    int severity
    string srcIp
    string hostname
    string agentId
    string rawJson "payload crudo de Wazuh"
    datetime receivedAt
  }

  INCIDENT {
    int id PK
    int alertId FK
    string status "new | blocked"
    datetime createdAt
    datetime blockedAt "nullable"
  }

  BLOCK_ACTION {
    int id PK
    int incidentId FK
    string agentId
    string wazuhResponse
    datetime executedAt
  }

  AUDIT_LOG {
    int id PK
    int incidentId FK
    string actor "analyst | system"
    string action
    datetime timestamp
  }
```

**Qué decisión encierra este dibujo:** separar `ALERT` de `INCIDENT` permite guardar el payload crudo de Wazuh sin perderlo (hoy se descarta después de normalizar), y `AUDIT_LOG` es justo el ítem que el PLAN pone en "si sobra tiempo" (sección 4) — con este modelo ya está pensado para no rediseñar nada si se llega a implementar antes del 18/08.

*Fuente: `orchestrator/prisma/schema.prisma`, `PLAN.md` sección 9 ("Diseño para escalar").*

---

## 5. Modelo de dominio objetivo (class diagram — trabajo futuro, no implementado)

Este es un modelo de dominio más completo que el DER roadmap de la sección 4: agrega `User`, `Asset` y `Playbook` como entidades propias, separa el enriquecimiento en `ThreatIntel` y modela la acción de bloqueo como `MitigationAction` (con reintentos y motivo de fallo) en vez de un `BLOCK_ACTION` plano. Es el "hacia dónde escala esto" para la sección de trabajo futuro de la tesis — **nada de esto está implementado** ni entra en el MVP del 18/08 (ver `PLAN.md` sección 4, "Fuera del MVP").

```mermaid
classDiagram
    class User {
        +string id
        +string name
        +string email
        +string role
        +string avatarUrl
        +getProfile() User
        +updateProfile(data) User
    }

    class Asset {
        +string id
        +string hostname
        +AssetCriticality criticality
        +string environment
        +listIncidents() Incident[]
    }

    class ThreatIntel {
        +string ip
        +string country
        +number reputationScore
        +boolean isMalicious
        +lookup(ip) ThreatIntel
    }

    class Incident {
        +string id
        +string type
        +Severity severity
        +IncidentStatus status
        +string attackerIp
        +number attempts
        +datetime createdAt
        +string assetId
        +recommendAction() MitigationAction
        +markResolved() void
        +markIgnored() void
    }

    class MitigationAction {
        +string id
        +string incidentId
        +string executedById
        +MitigationStatus status
        +number executionTimeMs
        +string failureReason
        +datetime executedAt
        +execute() MitigationAction
        +retry() MitigationAction
    }

    class Playbook {
        +string id
        +string name
        +string description
        +string[] steps
        +datetime publishedAt
        +publish() void
    }

    class ActivityLog {
        +string id
        +string title
        +ActivityType type
        +datetime timestamp
        +string relatedIncidentId
        +string performedById
        +record() ActivityLog
    }

    class Severity {
        <<enumeration>>
        LOW
        MEDIUM
        HIGH
        CRITICAL
    }

    class IncidentStatus {
        <<enumeration>>
        OPEN
        MITIGATED
        FAILED
        IGNORED
    }

    class MitigationStatus {
        <<enumeration>>
        PENDING
        SUCCESS
        FAILED
    }

    class AssetCriticality {
        <<enumeration>>
        LOW
        MEDIUM
        HIGH
        CRITICAL
    }

    class ActivityType {
        <<enumeration>>
        SYNC
        TRIAGE
        PLAYBOOK
        BLOCK
        OTHER
    }

    Asset "1" --> "many" Incident : is target of
    Incident "1" --> "1" ThreatIntel : resolves attacker via
    Incident "1" --> "many" MitigationAction : triggers
    Incident --> Severity
    Incident --> IncidentStatus
    Asset --> AssetCriticality
    MitigationAction --> MitigationStatus
    User "1" --> "many" MitigationAction : executes
    MitigationAction "1" --> "many" ActivityLog : generates
    User "1" --> "many" ActivityLog : performs
    Playbook "1" --> "many" MitigationAction : guides
    ActivityLog --> ActivityType
```

**Cómo se relaciona con lo que ya existe:**
- `Incident` (con `Severity`/`IncidentStatus`) es la evolución natural de la tabla `INCIDENT` de hoy — hoy `severity` es un `int` crudo de Wazuh y `status` es un string libre (`"new" | "blocked"`), acá quedarían como enums propios.
- `MitigationAction` reemplaza al `BLOCK_ACTION` del DER roadmap, agregando reintentos (`retry()`) y motivo de fallo — cosas que hoy `orchestrator/src/wazuh.js` no modela (si el bloqueo falla, solo se propaga un error 502, no se persiste el intento).
- `ThreatIntel` es la contraparte de "Enriquecimiento VT/AbuseIPDB cacheado" (`PLAN.md` sección 4, "si sobra tiempo").
- `ActivityLog` es el mismo concepto que `AUDIT_LOG` en el DER roadmap.
- `User`, `Asset` y `Playbook` son los tres conceptos genuinamente nuevos frente a todo lo documentado hasta ahora: no tienen equivalente ni en el código ni en el roadmap de `PLAN.md`. Son los que más rediseño de API y de app implicarían si algún día se implementan (login pasaría de env vars a tabla `User`, el bloqueo pasaría de "un endpoint" a "ejecutar un `Playbook`").

*Fuente: diagrama provisto por el usuario, contrastado contra `orchestrator/prisma/schema.prisma`, `orchestrator/src/{app,wazuh,auth}.js`, `PLAN.md` secciones 4 y 9.*
