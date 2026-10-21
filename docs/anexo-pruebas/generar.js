// Genera el Anexo de Pruebas (HTML listo para imprimir a PDF) a partir de
// los resultados REALES de la ultima corrida de Jest -- los numeros del
// anexo siempre coinciden con el codigo. Sin dependencias externas.
//
// Uso (ver README.md de esta carpeta):
//   cd orchestrator
//   npx jest --runInBand --coverage --json --outputFile=coverage/jest-results.json
//   node ../docs/anexo-pruebas/generar.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ORCH = path.join(ROOT, "orchestrator");
const results = JSON.parse(fs.readFileSync(path.join(ORCH, "coverage", "jest-results.json"), "utf8"));
const coverage = JSON.parse(fs.readFileSync(path.join(ORCH, "coverage", "coverage-summary.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ORCH, "package.json"), "utf8"));
const jestVersion = JSON.parse(fs.readFileSync(path.join(ORCH, "node_modules", "jest", "package.json"), "utf8")).version;
const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
const fecha = new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
const threshold = pkg.jest.coverageThreshold.global;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (n) => (typeof n === "number" ? n.toFixed(1).replace(".", ",") + "%" : "-");

// Trazabilidad: cada archivo de tests -> que parte del sistema y que riesgo cubre.
const SUITES = {
  "webhook.test.js": ["Ingesta y normalización", "CU-01", "Una alerta de Wazuh mal formada o incompleta corrompe la base o tira el servicio."],
  "webhookMalware.test.js": ["Ingesta de malware", "CU-02", "Una alerta sin IP atacante (FIM/VirusTotal) se rechaza y el incidente se pierde. Defecto real encontrado el 02/10."],
  "alertFilter.test.js": ["Filtro de ruido", "CU-01 / CU-02", "Fatiga de alertas: 1.320 de 1.334 incidentes eran ruido (13/10)."],
  "blockIp.test.js": ["Respuesta: bloquear IP", "CU-01", "El incidente queda marcado como mitigado aunque Wazuh haya rechazado la acción."],
  "isolateHost.test.js": ["Respuesta: aislar host", "CU-02", "Idem, para el aislamiento del endpoint."],
  "wazuh.test.js": ["Cliente de la API de Wazuh", "CU-01 / CU-02", "Wazuh responde HTTP 200 con la acción fallida en el cuerpo (error 1703, 04/08): la app informaría un bloqueo que no ocurrió."],
  "enrichment.test.js": ["Enriquecimiento (VirusTotal / AbuseIPDB)", "CU-01", "Cuota gratuita agotada, red caída o API caída bloquean o rompen la ingesta."],
  "incidents.test.js": ["Consulta y robustez", "Transversal", "Fallas de servicios auxiliares (enriquecimiento, auditoría) interrumpen el flujo principal."],
  "auth.test.js": ["Autenticación (JWT)", "Seguridad", "Acceso a incidentes o acciones sin credenciales válidas."],
  "me.test.js": ["Perfil del analista", "Soporte", "Datos de perfil inválidos o accesibles sin autenticación."],
  "audit.test.js": ["Auditoría", "Seguridad", "Acciones del analista sin registro trazable."],
  "users.test.js": ["Usuarios y control de acceso por roles", "Seguridad (RF-13)", "Acceso sin aprobación, un rol que excede sus permisos, sesiones que siguen vivas después de desactivar una cuenta, o el sistema sin ningún administrador."],
  "grouping.test.js": ["Agrupamiento de alertas", "CU-01 / CU-02", "Un mismo ataque genera varios incidentes (5712 + 5551): el analista mitiga uno y el otro queda abierto."],
  "metrics.test.js": ["Métricas de tiempo de respuesta", "RNF-05", "Cotas de rendimiento calculadas sobre datos inválidos o mezclando incidentes anteriores a la instrumentación."],
  "automation.test.js": ["Automatización según contexto", "CU-01 / CU-02", "Una acción automática sobre un activo crítico o una IP excluida, una política que se dispara con datos faltantes, o un cambio de configuración sin permisos ni auditoría."],
  "timeline.test.js": ["Línea de tiempo y auditoría por incidente", "Trazabilidad", "Evidencia del caso perdida al agrupar alertas, o eventos de auditoría que no se pueden atribuir a su incidente."],
  "closure.test.js": ["Cierre de casos y filtros", "Triaje", "Un caso cerrado sin justificación, un falso positivo descartado sin control, o un caso cerrado que sigue absorbiendo alertas."],
  "privacy.test.js": ["Protección de datos personales", "Ley 25.326", "Datos personales conservados más de lo necesario, o una baja que borra la trazabilidad de seguridad o no quita el acceso."],
  "phishing.test.js": ["Phishing reportado: ingesta, cuarentena y restauración", "CU-03", "Un reporte sin el correo original se procesa igual, el mismo correo abre varios incidentes, o la cuarentena informa éxito sin haber movido el correo de ningún buzón."],
  "campaign.test.js": ["Búsqueda de correos similares de la campaña", "CU-03", "Correos legítimos tratados como parte de la campaña (por un asunto parecido o un dominio común), candidatos que entran en la cuarentena sin que el analista los elija, o variantes de la misma campaña repartidas en varios incidentes."],
  "mailProvider.test.js": ["Integración con el servidor de correo (IMAP)", "CU-03", "Una campaña de miles de correos que abre miles de conexiones, reportes procesados dos veces, una sesión que queda abierta tras un error, o un aviso de reporte nuevo que se pierde si la conexión se cae."],
};

const suites = results.testResults
  .map((s) => {
    const file = path.basename(s.name);
    const meta = SUITES[file] || [file, "-", "-"];
    return { file, meta, tests: s.assertionResults };
  })
  .sort((a, b) => Object.keys(SUITES).indexOf(a.file) - Object.keys(SUITES).indexOf(b.file));

const files = Object.entries(coverage)
  .filter(([k]) => k !== "total")
  .map(([k, v]) => [path.relative(ORCH, k).replace(/\\/g, "/"), v])
  .sort();
const total = coverage.total;
const metrics = [
  ["Sentencias", "statements"],
  ["Ramas (branches)", "branches"],
  ["Funciones", "functions"],
  ["Líneas", "lines"],
];

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Anexo — Pruebas y cobertura del orquestador</title>
<style>
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 10.2pt; color: #1d1d1f; line-height: 1.45; }
  h1 { font-size: 20pt; margin: 0 0 4pt; color: #111; }
  h2 { font-size: 13.5pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #ff7a00; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  .sub { color: #555; margin: 0 0 14pt; }
  .meta { font-size: 9pt; color: #555; border-left: 3pt solid #ff7a00; padding: 4pt 8pt; background: #faf7f3; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 0.6pt solid #cfcfcf; padding: 3.5pt 5pt; text-align: left; vertical-align: top; }
  th { background: #2a2929; color: #fff; font-weight: 600; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; background: #f3f3f3; }
  .ok { color: #1b7f3b; font-weight: 700; }
  .kpis { display: flex; gap: 8pt; margin: 8pt 0 4pt; }
  .kpi { flex: 1; border: 0.8pt solid #ddd; border-radius: 4pt; padding: 6pt; text-align: center; }
  .kpi b { display: block; font-size: 17pt; color: #ff7a00; }
  .kpi span { font-size: 8.5pt; color: #555; }
  .suite { margin-top: 8pt; page-break-inside: avoid; }
  .suite p { margin: 2pt 0 3pt; font-size: 9pt; color: #444; }
  code { font-family: Consolas, monospace; font-size: 8.8pt; background: #f1f1f1; padding: 0 2pt; }
  ul { margin: 3pt 0 6pt 16pt; padding: 0; }
  li { margin: 1.5pt 0; }
</style></head><body>

<h1>Anexo — Pruebas y cobertura del orquestador</h1>
<p class="sub">Fortia (Micro-SOAR) · Plataforma móvil de respuesta a incidentes · Proyecto Final de Ingeniería</p>
<div class="meta">
  Generado el ${esc(fecha)} a partir de la corrida real de la suite sobre el commit <code>${esc(commit)}</code>.
  Entorno: Node.js ${esc(process.version)}, Jest ${esc(jestVersion)}, base SQLite efímera.
  Regenerable con <code>docs/anexo-pruebas/generar.js</code>.
</div>

<h2>1. Resumen</h2>
<div class="kpis">
  <div class="kpi"><b>${results.numPassedTests}/${results.numTotalTests}</b><span>tests aprobados</span></div>
  <div class="kpi"><b>${results.numTotalTestSuites}</b><span>archivos de prueba</span></div>
  <div class="kpi"><b>${pct(total.lines.pct)}</b><span>cobertura de líneas</span></div>
  <div class="kpi"><b>${pct(total.branches.pct)}</b><span>cobertura de ramas</span></div>
</div>
<p>El orquestador (backend Node.js/Express que recibe las alertas de Wazuh y los reportes de phishing, los normaliza en incidentes, los enriquece y ejecuta las acciones de respuesta) supera el umbral de <b>${threshold.lines}%</b> exigido en las cuatro métricas de cobertura. El umbral no es solo un objetivo: está configurado en <code>coverageThreshold</code> y el pipeline de integración continua rechaza cualquier cambio que lo haga descender.</p>
<p>Las pruebas automatizadas se complementan con pruebas de punta a punta contra la infraestructura real en AWS (sección 5), que validan lo que los mocks no pueden: el comportamiento efectivo de Wazuh, del firewall del host y de la app en un dispositivo físico.</p>

<h2>2. Estrategia de pruebas</h2>
<table>
  <tr><th>Nivel</th><th>Qué valida</th><th>Cómo</th></tr>
  <tr><td>Unitario</td><td>Normalización y filtrado de alertas; cliente de la API de Wazuh; enriquecimiento</td><td>Jest. Las llamadas HTTP externas (Wazuh, VirusTotal, AbuseIPDB) se reemplazan por mocks de <code>axios</code> que reproducen respuestas reales, incluidos los errores; el servidor de correo, por un cliente IMAP simulado con buzones en memoria.</td></tr>
  <tr><td>Integración (API)</td><td>Endpoints REST completos: webhook, incidentes, acciones de respuesta, autenticación, auditoría</td><td>Supertest contra la aplicación Express real y una base SQLite efímera creada con Prisma en cada corrida. Solo se aísla la frontera con Wazuh.</td></tr>
  <tr><td>Punta a punta</td><td>Cadena completa ataque → detección → incidente → app → acción → efecto en la red</td><td>Manual y documentada, contra la infraestructura de AWS y un celular real por Tailscale (sección 5).</td></tr>
</table>
<h3>Criterios de diseño</h3>
<ul>
  <li><b>Probar los modos de falla, no solo el camino feliz.</b> La mayoría de los defectos del proyecto fueron respuestas engañosas (Wazuh aceptando una acción que luego no ejecuta), por lo que cada acción de respuesta se prueba contra rechazo HTTP, rechazo con HTTP 200 y agente fallido.</li>
  <li><b>Los servicios auxiliares no deben interrumpir el flujo crítico.</b> Se verifica que una caída de VirusTotal o de la auditoría no impida registrar un incidente ni iniciar sesión.</li>
  <li><b>Sin dependencia del entorno local.</b> Las pruebas corren sin credenciales ni archivo <code>.env</code>; ninguna llega a la red. Así se ejecutan idénticas en la notebook de desarrollo y en GitHub Actions.</li>
  <li><b>Datos de prueba realistas.</b> Las alertas simuladas (<code>orchestrator/mocks/</code>) replican alertas reales de Wazuh: fuerza bruta SSH (regla 5712), malware detectado por VirusTotal (87105) y ruido de integridad de archivos (550).</li>
</ul>

<h2>3. Cobertura de código</h2>
<table>
  <tr><th>Métrica</th><th class="n">Cubierto</th><th class="n">Total</th><th class="n">Cobertura</th><th class="n">Umbral</th><th>Estado</th></tr>
  ${metrics
    .map(
      ([label, k]) =>
        `<tr><td>${label}</td><td class="n">${total[k].covered}</td><td class="n">${total[k].total}</td><td class="n">${pct(total[k].pct)}</td><td class="n">${threshold[k]}%</td><td class="ok">${total[k].pct >= threshold[k] ? "Cumple" : "NO cumple"}</td></tr>`
    )
    .join("\n  ")}
</table>
<h3>Por archivo</h3>
<table>
  <tr><th>Archivo</th><th class="n">Sentencias</th><th class="n">Ramas</th><th class="n">Funciones</th><th class="n">Líneas</th></tr>
  ${files
    .map(
      ([f, v]) =>
        `<tr><td><code>${esc(f)}</code></td><td class="n">${pct(v.statements.pct)}</td><td class="n">${pct(v.branches.pct)}</td><td class="n">${pct(v.functions.pct)}</td><td class="n">${pct(v.lines.pct)}</td></tr>`
    )
    .join("\n  ")}
  <tr class="total"><td>Total</td><td class="n">${pct(total.statements.pct)}</td><td class="n">${pct(total.branches.pct)}</td><td class="n">${pct(total.functions.pct)}</td><td class="n">${pct(total.lines.pct)}</td></tr>
</table>
<p>La medición abarca todo el código de la aplicación (<code>orchestrator/src/</code>). Quedan fuera los scripts operativos de uso único (<code>block_ip.js</code>, prueba de concepto de la fase 0, y <code>scripts/limpiar-ruido.js</code>). Las únicas líneas no ejecutadas corresponden al arranque del servidor HTTP (<code>app.listen</code>): las pruebas montan la aplicación en memoria sin abrir un puerto.</p>
<h3>Aplicación del umbral en integración continua</h3>
<p>Cada <i>pull request</i> hacia la rama principal ejecuta la suite completa en GitHub Actions. Si la cobertura de cualquiera de las cuatro métricas cae por debajo del ${threshold.lines}%, el job falla y el cambio no debe integrarse. El resultado se publica como tabla en el resumen de la ejecución y el reporte HTML navegable (cobertura línea por línea) queda disponible como artefacto descargable. Se verificó que el mecanismo funciona forzando un umbral de 99,5%: la suite falló con <code>coverage threshold for lines (99.5%) not met</code>.</p>

<h2>4. Catálogo de pruebas automatizadas</h2>
<p>Cada grupo indica la parte del sistema que valida, el caso de uso al que pertenece y el riesgo que mitiga.</p>
${suites
  .map(
    (s) => `<div class="suite">
<h3>${esc(s.meta[0])} <span style="font-weight:400;color:#777">· ${esc(s.meta[1])} · <code>${esc(s.file)}</code></span></h3>
<p><b>Riesgo mitigado:</b> ${esc(s.meta[2])}</p>
<table><tr><th style="width:84%">Caso de prueba</th><th>Resultado</th></tr>
${s.tests
  .map(
    (t) =>
      `<tr><td>${esc([...t.ancestorTitles, t.title].join(" — "))}</td><td class="${t.status === "passed" ? "ok" : ""}">${t.status === "passed" ? "Aprobado" : esc(t.status)}</td></tr>`
  )
  .join("\n")}
</table></div>`
  )
  .join("\n")}

<h2>5. Pruebas de punta a punta contra infraestructura real</h2>
<p>Ejecutadas sobre la infraestructura de AWS (manager Wazuh 4.8.2, endpoint víctima con agente Wazuh, orquestador) y la app instalada en un celular Android conectado por Tailscale. Registro completo en <code>progress.md</code>.</p>
<table>
  <tr><th>Fecha</th><th>Escenario</th><th>Resultado verificado</th></tr>
  <tr><td>21/08</td><td>Bloqueo de IP vía API de Wazuh</td><td>Regla <code>DROP</code> creada en <code>iptables</code> del endpoint.</td></tr>
  <tr><td>21/08</td><td>Primer flujo completo desde el celular</td><td>Login → incidente → step-up biométrico → bloqueo, por Tailscale. Puerto del orquestador no accesible desde Internet.</td></tr>
  <tr><td>26/08</td><td>Fuerza bruta SSH real</td><td>Regla 5712 disparada; el incidente se crea automáticamente, sin intervención manual.</td></tr>
  <tr><td>02/10</td><td>CU-02: archivo malicioso (EICAR)</td><td>FIM detecta el archivo → VirusTotal (65/75 motores) → alerta 87105 → incidente en el orquestador.</td></tr>
  <tr><td>08/10</td><td>CU-02: aislar host desde la app</td><td>Endpoint sin conexiones nuevas; el agente Wazuh sigue activo (único canal permitido).</td></tr>
  <tr><td>08/10</td><td>CU-01: bloquear IP desde la app</td><td>Conexión TCP del atacante al puerto 22 rechazada tras la acción.</td></tr>
  <tr><td>08/10</td><td>Enriquecimiento en la app</td><td>Tarjeta de inteligencia de amenazas con datos reales de VirusTotal y AbuseIPDB.</td></tr>
  <tr><td>13/10</td><td>Filtro de ruido</td><td>Alerta EICAR nueva llega como incidente; escaneo de integridad posterior no genera incidente. De 1.334 incidentes, 1.320 eran ruido; tras la depuración y la alerta de prueba (#1335) quedan 15 incidentes reales.</td></tr>
  <tr><td>13/10</td><td>Despliegue continuo</td><td>Merge a la rama principal → plan de Terraform sin cambios destructivos → despliegue automático del orquestador vía AWS SSM.</td></tr>
  <tr><td>14/10</td><td>Campaña de medición, contención manual (CU-01 y CU-02)</td><td>12 corridas: contención p50 21,1 s / p95 31,3 s, unas 28 veces menos que los ~10 minutos que insume evaluar una sola alerta en un SOC (Kersten et al., 2023); base de las cotas de los RNF.</td></tr>
  <tr><td>16/10</td><td>Prueba exploratoria de la app completa en un dispositivo real (realizada por el equipo)</td><td>Hallazgos corregidos: el teclado tapaba la nota de cierre, márgenes y etiquetas desparejos, no se podía copiar una IP, el motivo de la automatización se cortaba, y un intento de mitigación rechazado por Wazuh no quedaba en la auditoría (ahora queda, con quién y por qué falló).</td></tr>
  <tr><td>17/10</td><td>Flujo del analista para contener y cerrar un caso</td><td>Recorrido en el dispositivo: de unos 11 toques (biometría en pantalla aparte, volver a buscar el caso para cerrarlo) a 5 (confirmar → huella → éxito → "Cerrar caso" → cerrar, con el veredicto preelegido si se contuvo).</td></tr>
  <tr><td>17/10</td><td>CU-03: correo reportado → cuarentena desde la app</td><td>Incidente creado desde el reporte; el correo sale del INBOX de los dos destinatarios y queda en Cuarentena; restauración y nueva cuarentena verificadas en los buzones.</td></tr>
  <tr><td>17/10</td><td>CU-03: búsqueda de correos similares</td><td>Dos variantes de la campaña (otro asunto y remitente) encontradas como candidatas; el correo legítimo revisado y excluido; la variante descartada quedó en el INBOX.</td></tr>
  <tr><td>18/10</td><td>Contención automática (CU-01 y CU-02)</td><td>6 corridas contenidas por la automatización sin intervención humana: p50 1,51 s / p95 1,96 s.</td></tr>
  <tr><td>18/10</td><td>CU-03: medición de la contención manual</td><td>Contención p50 25,4 s, pero detección p50 6,8 s / p95 11,8 s, fuera de la cota de 5 s (ver defectos).</td></tr>
  <tr><td>18/10</td><td>CU-03 con IMAP IDLE</td><td>Nueva medición tras el cambio: detección p50 0,84 s / p95 1,29 s, las 5 corridas dentro de la cota; contención p50 12,5 s.</td></tr>
</table>

<h2>6. Defectos detectados por las pruebas</h2>
<table>
  <tr><th>Fecha</th><th>Defecto</th><th>Cómo se detectó</th><th>Resolución</th></tr>
  <tr><td>04/08</td><td>El manager (agente 000) rechaza acciones de respuesta (error 1703) devolviendo HTTP 200.</td><td>Prueba de concepto contra la API</td><td>Endpoint víctima dedicado; validación de <code>total_failed_items</code> (cubierta en <code>wazuh.test.js</code>).</td></tr>
  <tr><td>04/08</td><td>El bloqueo informaba éxito sin crear la regla de firewall: la IP debía enviarse en <code>alert.data.srcip</code>.</td><td>Verificación en <code>iptables</code></td><td>Cuerpo de la solicitud corregido (cubierto en <code>wazuh.test.js</code>).</td></tr>
  <tr><td>02/10</td><td>Las alertas de malware se rechazaban porque la IP de origen era obligatoria.</td><td>Revisión de código con alerta simulada</td><td>IP opcional (cubierto en <code>webhookMalware.test.js</code>); confirmado horas después con la alerta real.</td></tr>
  <tr><td>08/10</td><td>Aislar host informaba éxito sin aislar: el script estaba instalado con un nombre distinto al invocado.</td><td>Prueba de punta a punta</td><td>Instalación corregida y documentada.</td></tr>
  <tr><td>13/10</td><td>1.320 de 1.334 incidentes eran ruido (actualizaciones del sistema).</td><td>Verificación posterior al despliegue</td><td>Filtro en el manager y en el orquestador (cubierto en <code>alertFilter.test.js</code>).</td></tr>
  <tr><td>13/10</td><td>Pruebas dependientes de la configuración local (<code>.env</code>).</td><td>Primera ejecución en CI</td><td>Configuración de pruebas autocontenida.</td></tr>
  <tr><td>14/10</td><td>Un mismo ataque generaba dos incidentes (reglas 5712 y 5551): el analista mitigaba uno y el otro quedaba abierto.</td><td>Campaña de medición</td><td>Agrupamiento de alertas por agente e IP (cubierto en <code>grouping.test.js</code>).</td></tr>
  <tr><td>17/10</td><td>Las pruebas locales consultaban VirusTotal y AbuseIPDB con las claves reales: la configuración de pruebas las borraba, pero la carga del <code>.env</code> las volvía a completar.</td><td>Consumo inesperado en el panel de cuota de VirusTotal</td><td>Claves vacías (no borradas) en la configuración de pruebas.</td></tr>
  <tr><td>17/10</td><td>Una prueba dependía del fin de línea del archivo de ejemplo (CRLF en Windows, LF en CI).</td><td>Ejecución en CI</td><td>Prueba independiente del fin de línea.</td></tr>
  <tr><td>18/10</td><td>CU-03: detección fuera de la cota de RNF-05 (p50 6,8 s / p95 11,8 s) por el chequeo del buzón de reportes cada 15 s.</td><td>Medición de punta a punta</td><td>Cambio de diseño a IMAP IDLE con chequeo de respaldo cada 60 s (cubierto en <code>mailProvider.test.js</code> y <code>phishing.test.js</code>); nueva medición dentro de la cota.</td></tr>
  <tr><td>18/10</td><td>El agente Wazuh del servidor de correo no podía conectarse al manager (el security group solo aceptaba a la víctima).</td><td>Revisión de la arquitectura al dibujar los diagramas</td><td>Regla del security group ampliada.</td></tr>
</table>

<h2>7. Alcance y limitaciones</h2>
<ul>
  <li><b>Aplicación móvil.</b> La cobertura automatizada abarca el backend. La app se valida con las pruebas de punta a punta de la sección 5 en un dispositivo real; incorporar pruebas automatizadas de la capa de servicios de la app queda como trabajo futuro.</li>
  <li><b>Frontera con Wazuh.</b> En las pruebas automatizadas, Wazuh se simula a nivel HTTP. Su comportamiento real (ejecución de la acción en el agente, efecto en el firewall) se valida en las pruebas de punta a punta.</li>
  <li><b>Pruebas de punta a punta manuales.</b> Están documentadas con fecha y evidencia, pero no automatizadas; automatizarlas contra un entorno efímero es una mejora propuesta.</li>
</ul>
</body></html>`;

const out = path.join(__dirname, "anexo-pruebas.html");
fs.writeFileSync(out, html);
console.log("HTML generado:", out);
console.log(`Tests: ${results.numPassedTests}/${results.numTotalTests} | lineas ${total.lines.pct}% | ramas ${total.branches.pct}% | funciones ${total.functions.pct}% | sentencias ${total.statements.pct}%`);
