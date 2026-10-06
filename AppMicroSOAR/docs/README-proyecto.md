# Micro-SOAR — PFI Ciberseguridad

Plataforma que baja el tiempo de contención de un ataque de fuerza bruta SSH:
Wazuh detecta → un orquestador normaliza y persiste el incidente → una app
móvil permite bloquear la IP atacante con un toque (step-up auth) sobre un
canal Zero Trust (Tailscale).

## Documentación viva

Leer en este orden:

1. [`PLAN.md`](PLAN.md) — el mapa: alcance, arquitectura, contrato de API, roadmap.
2. [`progress.md`](progress.md) — el diario: qué se hizo, qué falló, próximo paso concreto. **Empezar por acá para saber dónde retomar.**
3. [`BITACORA_DESARROLLO.md`](BITACORA_DESARROLLO.md) — registro narrativo de decisiones técnicas y problemas resueltos, para la defensa del PFI.
4. [`CLAUDE.md`](CLAUDE.md) — cómo trabajamos (simplicidad primero, cambios quirúrgicos, etc.), útil si usás Claude Code en este repo.

## Estructura del repo

```
terraform/        # infra AWS (Wazuh manager + víctima + orchestrator). Ver terraform/terraform.tfvars.example
orchestrator/      # backend Node.js/Express: webhook Wazuh -> Incident -> DB (Prisma)
AppMicroSOAR/      # app móvil Expo/React Native: login, incidentes, step-up biométrico, bloqueo
```

## Estado actual (ver detalle y próximo paso en `progress.md`)

- **Fase 0** (bloqueo de IP vía API de Wazuh): ✅ confirmado contra infraestructura real — el bloqueo dropea una IP de verdad (regla `DROP` verificada en `iptables`).
- **Fase 1** (webhook → normalización → persistencia → listado): ✅ conectado a Wazuh real — un brute-force SSH real crea el incidente solo, sin inyección manual.
- **Fase 2** (app consumiendo): ✅ login, lista, detalle y bloqueo probados de punta a punta desde un celular real, por Tailscale.
- **Fase 3** (step-up + enriquecimiento): 🟡 step-up biométrico real ya funciona; enriquecimiento y audit log siguen pendientes (opcionales).
- **Fase 4** (hardening y ensayo): 🟡 security groups cerrados y confirmados; falta video de respaldo y ensayo cronometrado antes de la demo del 1/9.

## Orchestrator — cómo levantarlo

```bash
cd orchestrator
npm install
npx prisma generate
npx prisma db push          # crea el SQLite local según prisma/schema.prisma
cp .env.example .env        # completar con credenciales reales
npm start                   # http://localhost:8000
npm test
```

Con el server arriba, `POST /api/v1/webhook/wazuh` con el contenido de
`orchestrator/mocks/wazuh_ssh_bruteforce.json` como body simula una alerta
real y persiste el incidente; `GET /api/v1/incidents` lo lista.

`block_ip.js` es independiente del server Express: es el spike de Fase 0,
ejecutá `npm run block-ip` (o `node block_ip.js`) una vez tengas el `.env`
con las credenciales del manager de Wazuh.

## Próximo paso

Ver "Próximo paso concreto" de la última entrada en
[`progress.md`](progress.md#bitácora-de-sesiones).
