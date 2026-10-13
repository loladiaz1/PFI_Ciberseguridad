# Micro-SOAR — PFI Ciberseguridad

Plataforma que baja el tiempo de contención de un incidente: Wazuh detecta →
un orquestador filtra, normaliza, enriquece (VirusTotal / AbuseIPDB) y persiste
el incidente → una app móvil permite responder con un toque, con step-up
biométrico, sobre un canal Zero Trust (Tailscale). Dos casos de uso:

- **CU-01 — Fuerza bruta SSH:** bloquear la IP atacante.
- **CU-02 — Malware en un endpoint:** aislar el host de la red.

## Documentación viva

Leer en este orden:

1. [`PLAN.md`](PLAN.md) — el mapa: alcance, arquitectura, contrato de API, roadmap.
2. [`progress.md`](progress.md) — el diario: qué se hizo, qué falló, próximo paso concreto. **Empezar por acá para saber dónde retomar.**
3. [`BITACORA_DESARROLLO.md`](BITACORA_DESARROLLO.md) — registro narrativo de decisiones técnicas y problemas resueltos, para la defensa del PFI.
4. [`CLAUDE.md`](CLAUDE.md) — cómo trabajamos (simplicidad primero, cambios quirúrgicos, etc.), útil si usás Claude Code en este repo.

## Estructura del repo

```
terraform/         # infra AWS (Wazuh manager + víctima + orchestrator + CI/CD). Ver terraform/terraform.tfvars.example
orchestrator/      # backend Node.js/Express: webhook Wazuh -> filtro -> Incident -> DB (Prisma) -> acciones
AppMicroSOAR/      # app móvil Expo/React Native: login, incidentes, step-up biométrico, bloquear / aislar
.github/workflows/ # CI (plan + tests con cobertura en cada PR) y deploy automático en merge a main
docs/anexo-pruebas/ # anexo de pruebas y cobertura para la tesis (PDF regenerable)
```

## Estado actual (ver detalle y próximo paso en `progress.md`)

- **Fase 0** (bloqueo de IP vía API de Wazuh): ✅ confirmado contra infraestructura real — el bloqueo dropea una IP de verdad (regla `DROP` verificada en `iptables`).
- **Fase 1** (webhook → normalización → persistencia → listado): ✅ conectado a Wazuh real — un brute-force SSH real crea el incidente solo, sin inyección manual.
- **Fase 2** (app consumiendo): ✅ login, lista, detalle y bloqueo probados de punta a punta desde un celular real, por Tailscale.
- **Fase 3** (step-up + enriquecimiento): ✅ step-up biométrico, audit log y enriquecimiento VT/AbuseIPDB funcionando, con la tarjeta de inteligencia de amenazas en la app (probada en celular el 08/10).
- **CU-02** (aislar endpoint): ✅ detección real (EICAR → VirusTotal → incidente) y aislamiento real desde el celular, confirmados el 08/10.
- **CI/CD**: ✅ cada PR corre `terraform plan` + tests con umbral de cobertura; cada merge a `main` aplica Terraform (con freno anti-destroy) y deploya el orchestrator vía SSM, sin credenciales guardadas (OIDC). Funcionando desde el 13/10.
- **Calidad**: ✅ cobertura del orchestrator 98,9% líneas / 91,5% ramas (umbral obligatorio 85%), 49 tests. Anexo para la tesis en [`docs/anexo-pruebas/`](docs/anexo-pruebas/).
- **Fase 4** (hardening y ensayo): 🟡 security groups cerrados, filtro de ruido de alertas (13/10: 1335 → 15 incidentes reales); falta video de respaldo y ensayo cronometrado.

## Orchestrator — cómo levantarlo

```bash
cd orchestrator
npm install
npx prisma generate
npx prisma db push          # crea el SQLite local según prisma/schema.prisma
cp .env.example .env        # completar con credenciales reales
npm start                   # http://localhost:8000
npm test
npm run test:coverage       # tests + cobertura (falla si baja de 85%); reporte en coverage/index.html
```

Con el server arriba, `POST /api/v1/webhook/wazuh` con el contenido de
`orchestrator/mocks/wazuh_ssh_bruteforce.json` como body simula una alerta
real y persiste el incidente; `GET /api/v1/incidents` lo lista.

Las alertas que no son de los casos de uso (por ejemplo
`orchestrator/mocks/wazuh_fim_noise.json`) se responden con
`202 {"ignored": true}` y no crean incidente.

`block_ip.js` es independiente del server Express: es el spike de Fase 0,
ejecutá `npm run block-ip` (o `node block_ip.js`) una vez tengas el `.env`
con las credenciales del manager de Wazuh.

## Cómo se trabaja con el repo

- Cada cambio va en una rama `feature/...` y entra a `main` por Pull Request.
- El CI comenta el `terraform plan` en el PR: **leerlo antes de mergear** (el merge es la aprobación del deploy).
- Al mergear, el deploy aplica Terraform y actualiza el orchestrator. Para que el deploy del orchestrator funcione, la instancia tiene que estar **prendida**.
- Apagar las 3 instancias al terminar de trabajar (costo).

## Próximo paso

Ver "Próximo paso concreto" de la última entrada en
[`progress.md`](progress.md#bitácora-de-sesiones).
