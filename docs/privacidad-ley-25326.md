# Marco legal y de privacidad — Ley 25.326 de Protección de los Datos Personales

> Base para el apartado de la tesis pedido en la devolución de E50 (requisito
> de E75: "Marco legal y de privacidad: anonimización de datos y Ley 25.326").
> Describe lo que el sistema **implementa hoy**; cada punto remite al código.
>
> **Nota interna (no copiar a la tesis):** la correspondencia con cada
> artículo es una interpretación técnica de la ley, no la opinión de un
> profesional del derecho. Antes de incorporarla a la tesis, validarla con el
> docente que pidió el marco legal, en especial el art. 12 (transferencia
> internacional), que figura como pendiente de análisis.

## 1. Datos personales que trata el sistema

| Dato | Titular | Dónde se guarda | Finalidad |
|---|---|---|---|
| Usuario, nombre, email, rol | Analista | Base del orquestador (`User`) | Identificar al operador de la plataforma |
| Registro de acciones (login, bloqueo de IP, aislamiento), con fecha y hora | Analista | Base del orquestador (`AuditEvent`, campo `actor`) | Trazabilidad de las acciones críticas de seguridad |
| Token de sesión (JWT) | Analista | Almacenamiento seguro del celular (`expo-secure-store`) | Autenticación |
| Dirección IP de origen de un ataque | Tercero (atacante) | `Incident.srcIp`, enriquecimiento, detalle de auditoría | Contener el ataque y evaluar su riesgo |
| Datos biométricos | Analista | **No se tratan**: la validación la hace el sistema operativo del celular; la app solo recibe "aprobado / rechazado" | — |

La dirección IP se trata como dato personal porque, combinada con otros
datos, puede identificar a una persona.

## 2. Correspondencia con la ley

| Artículo | Exigencia | Cómo se cumple | Implementación |
|---|---|---|---|
| Art. 4 — Calidad de los datos | Datos adecuados, pertinentes y no excesivos para la finalidad; destruirlos cuando dejan de ser necesarios (inc. 7) | Se recolecta lo mínimo (no hay DNI, teléfono, ubicación ni biometría). **Política de retención:** a los 90 días, las IPs de origen se enmascaran a su red (/24 en IPv4, /64 en IPv6) y se descarta la información de reputación asociada | `orchestrator/src/privacy.js` → `applyRetention`; `orchestrator/scripts/aplicar-retencion.js` (plazo configurable con `RETENTION_DAYS`) |
| Art. 5 — Consentimiento | Consentimiento libre, expreso e informado | El registro exige aceptar la política de privacidad | `AppMicroSOAR/app/register.tsx` (casilla obligatoria) |
| Art. 6 — Información al titular | Informar finalidad, destinatarios, responsable, derechos | Pantalla "Política de privacidad", accesible sin sesión y desde Perfil, con la leyenda exigida por la Disposición 10/2008 | `AppMicroSOAR/app/privacy.tsx` |
| Art. 9 — Seguridad de los datos | Medidas técnicas que garanticen la seguridad y confidencialidad | Canal cifrado y privado (Tailscale, sin puertos expuestos a internet); autenticación JWT en cada request; step-up biométrico para acciones críticas; credenciales del servidor con permisos `600`; despliegue sin credenciales guardadas (OIDC) | Ver capítulo de arquitectura y `PLAN.md` |
| Art. 12 — Transferencia internacional | Transferir solo a países con protección adecuada o con resguardos | La IP del atacante se consulta en VirusTotal y AbuseIPDB, y la plataforma se aloja en AWS (EE.UU.). Se informa en la política de privacidad. **Pendiente de análisis**: base legal de la transferencia (finalidad de seguridad / cláusulas contractuales de los proveedores) | `orchestrator/src/enrichment.js`; `AppMicroSOAR/app/privacy.tsx` |
| Art. 14 — Derecho de acceso | Acceso gratuito a los propios datos | El analista ve su perfil y su actividad en la app | `GET /api/v1/me`, `GET /api/v1/audit` |
| Art. 16 — Rectificación y supresión | Rectificar y suprimir los datos | Edición del perfil; **eliminación de la cuenta** desde Perfil | `PUT /api/v1/me`; `DELETE /api/v1/me` |

## 3. Supresión sin perder la trazabilidad

Existe una tensión entre dos obligaciones: el derecho de supresión (art. 16)
y la necesidad de conservar el registro de las acciones de seguridad
(art. 9; RNF-09). Borrar el registro de auditoría permitiría, por ejemplo,
que no quede rastro de quién aisló un equipo. La solución adoptada es la
**seudonimización**:

1. Al eliminar la cuenta se borra el perfil (nombre y email).
2. En cada evento de auditoría, el usuario se reemplaza por un seudónimo
   (`usuario-eliminado-` + 8 caracteres de un HMAC-SHA256 con un secreto del
   servidor). Los eventos de la misma persona siguen agrupados, pero sin el
   secreto no se puede volver al usuario original.
3. Se registra un evento `account_deleted` con el seudónimo.
4. Todo ocurre en una única transacción: o se completa entero, o no cambia
   nada.

Para que esto sea posible, el usuario que ejecuta cada acción se guarda en un
campo separado (`actor`) y no dentro del texto del evento.

## 4. Anonimización de datos de terceros

Las IPs de origen se conservan completas mientras son necesarias para
contener e investigar el ataque. Pasado el plazo de retención se enmascaran
(`203.0.113.55` → `203.0.113.0/24`): se conserva el valor estadístico (de qué
red provino el ataque) sin identificar al equipo. La operación es
idempotente y tiene un modo de prueba que muestra qué cambiaría sin
modificar nada.

## 5. Verificación

Cubierto por pruebas automatizadas (`orchestrator/tests/privacy.test.js`):
seudónimo estable y no reversible a simple vista; enmascarado de IPv4/IPv6 e
idempotencia; la eliminación de la cuenta borra el perfil, seudonimiza los
eventos (incluidos los de formato anterior) y no borra ninguno; la retención
enmascara solo lo vencido y no vuelve a tocar lo ya enmascarado.

## 6. Limitaciones y trabajo futuro

- La retención se ejecuta a mano (`aplicar-retencion.js`); automatizarla con
  una tarea programada en la instancia.
- Las credenciales del MVP son de configuración (un solo usuario): eliminar
  la cuenta borra los datos personales guardados, pero no la credencial. Con
  usuarios reales en base de datos, la eliminación debería además
  deshabilitar el acceso.
- Registro de la base de datos ante la Agencia de Acceso a la Información
  Pública (art. 21) y designación formal del responsable: corresponden a la
  organización que adopte la plataforma.
- Base legal de las transferencias internacionales (art. 12).
