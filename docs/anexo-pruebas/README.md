# Anexo de pruebas y cobertura

`anexo-pruebas.pdf` es el anexo de la tesis con la estrategia de pruebas, la
cobertura del orquestador, el catálogo de tests trazado a casos de uso y
riesgos, las pruebas de punta a punta contra la infraestructura real y los
defectos encontrados.

Los números salen de la **corrida real** de Jest, no se escriben a mano.
Regenerarlo cada vez que cambien los tests (por ejemplo, antes de una entrega):

```powershell
cd orchestrator
npx jest --runInBand --coverage --json --outputFile=coverage/jest-results.json
node ../docs/anexo-pruebas/generar.js
cd ../docs/anexo-pruebas
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD\anexo-pruebas.pdf" "file:///$($PWD -replace '\\','/')/anexo-pruebas.html"
```

- Las secciones narrativas (estrategia, pruebas de punta a punta, defectos,
  limitaciones) y la trazabilidad de cada archivo de tests (`SUITES`) están en
  `generar.js`: si se agrega un archivo de tests nuevo, sumarlo ahí.
- `anexo-pruebas.html` es intermedio (no se versiona); el PDF sí.
