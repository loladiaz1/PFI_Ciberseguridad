# Micro-SOAR — PFI Ciberseguridad

Plataforma que baja el tiempo de contención de un ataque de fuerza bruta SSH:
Wazuh detecta → un orquestador normaliza y persiste el incidente → una app
móvil permite bloquear la IP atacante con un toque (step-up auth) sobre un
canal Zero Trust (Tailscale).

## Documentación viva

Leer en este orden:

1. [`PLAN.md`](PLAN.md) — el mapa: alcance, arquitectura, contrato de API, roadmap.
2. [`progress.md`](progress.md) — el diario: qué se hizo, qué falló, próximo paso concreto. **Empezar por acá para saber dónde retomar.**
3. [`CLAUDE.md`](CLAUDE.md) — cómo trabajamos (simplicidad primero, cambios quirúrgicos, etc.), útil si usás Claude Code en este repo.

## Estructura del repo

```
terraform/       # infra AWS (Wazuh manager). Ver terraform/terraform.tfvars.example
orchestrator/     # backend Python/FastAPI: webhook Wazuh -> Incident -> DB
```

## Estado actual (ver detalle y próximo paso en `progress.md`)

- **Fase 0** (bloqueo de IP vía API de Wazuh): script listo (`orchestrator/block_ip.py`), falta correrlo contra el manager real — todavía en instalación.
- **Fase 1** (webhook → normalización → persistencia → listado): funcionando en local contra un mock de alerta, con tests en verde. Falta conectarlo a Wazuh real.

## Orchestrator — cómo levantarlo

```bash
cd orchestrator
python -m venv .venv
./.venv/Scripts/Activate.ps1      # PowerShell (Git Bash: source .venv/Scripts/activate)
pip install -r requirements.txt
cp .env.example .env              # completar con credenciales reales cuando existan
uvicorn app.main:app --reload     # http://127.0.0.1:8000/docs
pytest -v
```

Con el server arriba, `POST /api/v1/webhook/wazuh` con el contenido de
`orchestrator/mocks/wazuh_ssh_bruteforce.json` como body simula una alerta
real y persiste el incidente; `GET /api/v1/incidents` lo lista.

`block_ip.py` es independiente del server FastAPI: es el spike de Fase 0,
ejecutá `python block_ip.py` una vez tengas el `.env` con las credenciales
del manager de Wazuh.

## Próximo paso

Ver "Próximo paso concreto" de la última entrada en
[`progress.md`](progress.md#bitácora-de-sesiones).
