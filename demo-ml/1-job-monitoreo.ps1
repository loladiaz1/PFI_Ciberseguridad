# Demo del recomendador: un job de monitoreo con credenciales vencidas.
# La victima intenta entrar por SSH a si misma con un usuario que no existe:
# Wazuh lo ve como fuerza bruta (regla 5712) desde 127.0.0.1. Es un benigno
# positivo clasico: la deteccion es correcta, la actividad es legitima.
# No toca la infraestructura: el trafico a 127.0.0.1 no pasa por el security
# group. Cada corrida abre un incidente nuevo si el anterior ya se cerro.
. "$PSScriptRoot\..\demo-cu01-02\_victima.ps1"

Write-Host "Job de monitoreo en la victima: 12 intentos de SSH a 127.0.0.1..." -ForegroundColor Yellow
Invoke-Victim 'for i in $(seq 1 12); do ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=3 monitoreo@127.0.0.1 exit 2>&1 | tail -n 1; sleep 0.5; done'
Write-Host "Listo: el incidente aparece en la app en unos segundos." -ForegroundColor Green
