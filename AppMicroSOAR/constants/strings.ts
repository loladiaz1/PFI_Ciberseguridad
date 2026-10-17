import type { AutomationMode, Criticality, IncidentEmail, IncidentStatus, MitigationAction, Role, Verdict } from "@/types";

// Todos los textos de la app, en un solo lugar y agrupados por pantalla.
// Los textos con datos son funciones. Para sumar otro idioma, este objeto
// pasa a ser uno por idioma (es, en, ...) con la misma forma.
export const LOCALE = "es-AR";

export const formatDate = (value: string | number | Date) => new Date(value).toLocaleString(LOCALE);

export const S = {
  common: {
    back: "Volver",
    cancel: "Cancelar",
    save: "Guardar",
    saving: "Guardando...",
    error: "Error",
    genericError: "Algo salió mal. Intentá de nuevo.",
    noConnection: "No se pudo conectar con el servidor",
    tooManyAttempts: "Demasiados intentos. Esperá unos minutos e intentá de nuevo.",
    by: (actor: string) => `por ${actor}`,
  },

  // Datos que se repiten en varias pantallas.
  fields: {
    name: "Nombre",
    email: "Email",
    role: "Rol",
    severity: "Severidad",
    target: "Objetivo",
    attackerIp: "IP atacante",
    agent: "Agente",
    status: "Estado",
  },

  severity: {
    critical: "CRÍTICA",
    high: "ALTA",
    medium: "MEDIA",
    low: "BAJA",
  },

  incidentStatus: {
    new: "nuevo",
    blocked: "IP bloqueada",
    isolated: "host aislado",
    quarantined: "correo en cuarentena",
    restored: "correo restaurado",
  } as Record<IncidentStatus, string>,
  closed: "cerrado",

  roles: {
    admin: "administrador",
    analyst: "analista",
    auditor: "auditor",
  } as Record<Role, string>,

  criticality: {
    low: "baja",
    medium: "media",
    high: "alta",
    critical: "crítica",
  } as Record<Criticality, string>,

  // Cada accion en el flujo step-up -> confirmar -> ejecutar -> listo.
  // target = lo que se muestra como objetivo (IP, host o asunto del correo).
  flow: {
    "block-ip": {
      label: "BLOQUEAR IP",
      prompt: "Confirmá que sos vos para bloquear esta IP",
      confirm: "Estás por bloquear la siguiente IP",
      targetLabel: "IP",
      warning: "Esta acción actualiza las reglas del firewall y bloquea al atacante.",
      steps: (target: string) => ["Conectando con Wazuh...", `Bloqueando ${target}...`, "Actualizando el firewall..."],
      rejected: "Wazuh rechazó el comando de bloqueo. Intentá de nuevo.",
      done: "La IP maliciosa quedó bloqueada.",
      doneLabel: "IP bloqueada",
    },
    "isolate-host": {
      label: "AISLAR HOST",
      prompt: "Confirmá que sos vos para aislar este host",
      confirm: "Estás por aislar el siguiente host",
      targetLabel: "Host",
      warning: "Esta acción corta todo el tráfico de red del host, salvo su canal con el manager de Wazuh.",
      steps: (target: string) => ["Conectando con Wazuh...", `Aislando ${target}...`, "Cortando el acceso a la red..."],
      rejected: "Wazuh rechazó el comando de aislamiento. Intentá de nuevo.",
      done: "El host quedó aislado de la red.",
      doneLabel: "Host aislado",
    },
    "quarantine-email": {
      label: "PONER EN CUARENTENA",
      prompt: "Confirmá que sos vos para poner este correo en cuarentena",
      confirm: "Estás por sacar este correo de todos los buzones donde llegó",
      targetLabel: "Correo",
      warning: "El correo se mueve a la carpeta Cuarentena de cada buzón. Si resulta legítimo, se puede restaurar.",
      steps: () => ["Conectando con el servidor de correo...", "Buscando el correo en los buzones...", "Moviéndolo a cuarentena..."],
      rejected: "No se pudo poner el correo en cuarentena.",
      done: "El correo quedó en cuarentena en los buzones donde estaba.",
      doneLabel: "Correo en cuarentena",
    },
    "restore-email": {
      label: "RESTAURAR CORREO",
      prompt: "Confirmá que sos vos para restaurar este correo",
      confirm: "Estás por devolver este correo a la bandeja de entrada",
      targetLabel: "Correo",
      warning: "Hacelo solo si el correo es legítimo: vuelve a la bandeja de entrada de todos los destinatarios.",
      steps: () => ["Conectando con el servidor de correo...", "Devolviendo el correo a las bandejas de entrada..."],
      rejected: "No se pudo restaurar el correo.",
      done: "El correo volvió a la bandeja de entrada.",
      doneLabel: "Correo restaurado",
    },
  } as Record<
    MitigationAction,
    {
      label: string;
      prompt: string;
      confirm: string;
      targetLabel: string;
      warning: string;
      steps: (target: string) => string[];
      rejected: string;
      done: string;
      doneLabel: string;
    }
  >,

  verdicts: {
    true_positive: { label: "Verdadero positivo", help: "Un ataque o una infección real." },
    benign_positive: {
      label: "Benigno positivo",
      help: "La detección fue correcta, pero la actividad era legítima (ej.: un escaneo autorizado).",
    },
    false_positive: { label: "Falso positivo", help: "La detección fue errónea: no pasó nada." },
  } as Record<Verdict, { label: string; help: string }>,

  // Catalogo de etiquetas del cierre (las claves las define el backend,
  // orchestrator/src/closure.js).
  tags: {
    brute_force: "Fuerza bruta",
    malware: "Malware",
    phishing: "Phishing",
    ip_blocked: "IP bloqueada",
    host_isolated: "Host aislado",
    email_quarantined: "Correo en cuarentena",
    escalated: "Escalado",
    authorized_activity: "Actividad autorizada",
    test_exercise: "Prueba / ejercicio",
    recurring_attacker: "Atacante recurrente",
    rule_tuning_needed: "Ajustar la regla",
  } as Record<string, string>,

  tabs: {
    dashboard: "Inicio",
    incidents: "Incidentes",
    activity: "Actividad",
    profile: "Perfil",
  } as Record<string, string>,

  biometrics: {
    requiredTitle: "Biometría requerida",
    notEnrolled: "Este dispositivo no tiene biometría configurada. Configurá Face ID o la huella para continuar.",
  },

  login: {
    subtitle: "Centro de Operaciones de Seguridad",
    username: "Usuario",
    password: "Contraseña",
    invalidCredentials: "Usuario o contraseña incorrectos",
    accountNotActive: "La cuenta no está activa",
    usernameEntered: "Usuario ingresado",
    passwordEntered: "Contraseña ingresada",
    submitting: "INGRESANDO...",
    submit: "INGRESAR",
    noAccount: "¿No tenés cuenta? Registrate",
  },

  register: {
    incompleteTitle: "Campos incompletos",
    incompleteBody: "Completá todos los campos.",
    invalidNameTitle: "Nombre inválido",
    invalidNameBody: "El nombre tiene que tener al menos 2 caracteres.",
    invalidEmailTitle: "Email inválido",
    invalidEmailBody: "Ingresá un email válido.",
    weakPasswordTitle: "Contraseña débil",
    weakPasswordBody:
      "La contraseña tiene que tener al menos 9 caracteres, una mayúscula, una minúscula, un número y un carácter especial.",
    privacyTitle: "Política de privacidad",
    privacyBody: "Para crear una cuenta tenés que leer y aceptar la política de privacidad.",
    sentTitle: "Registro enviado",
    sentBody: "Un administrador tiene que aprobar tu cuenta antes de que puedas ingresar. Tu usuario es tu email.",
    failedTitle: "No se pudo registrar",
    failed: "No se pudo crear la cuenta.",
    emailTaken: "Ese email ya está registrado.",
    namePlaceholder: "Nombre",
    emailPlaceholder: "ejemplo@empresa.com",
    passwordPlaceholder: "Contraseña",
    rules: {
      name: "El nombre tiene al menos 2 caracteres",
      email: "Email válido",
      length: "Al menos 9 caracteres",
      uppercase: "Al menos una mayúscula",
      lowercase: "Al menos una minúscula",
      number: "Al menos un número",
      special: "Al menos un carácter especial",
    },
    acceptPrefix: "Leí y acepto la",
    privacyLink: "política de privacidad",
    submitting: "CREANDO CUENTA...",
    submit: "REGISTRARME",
    haveAccount: "¿Ya tenés cuenta? Ingresá",
  },

  dashboard: {
    greeting: "Hola",
    role: "Analista SOC",
    threatLevel: "Nivel de amenaza",
    clear: "SIN AMENAZAS",
    openIncidents: (n: number) => `${n} incidente${n === 1 ? "" : "s"} por atender`,
    toAttend: "Por atender",
    toClose: "Por cerrar",
    closedToday: "Cerrados hoy",
    recent: "Incidentes recientes",
    viewAll: "Ver todos",
  },

  incidents: {
    title: "Incidentes",
    loadError: "No se pudieron cargar los incidentes",
    search: "Buscar #número, host o IP",
    filters: (active: number) => `Filtros${active ? ` (${active})` : ""}`,
    any: "Cualquiera",
    status: { open: "Abiertos", closed: "Cerrados", all: "Todos" },
    contained: { yes: "Contenidos", no: "Sin contener", auto: "Automáticos" },
    useCase: { bruteForce: "Fuerza bruta", malware: "Malware", phishing: "Phishing" },
    minSeverity: { medium: "Media o más", high: "Alta o más", critical: "Crítica" },
    sort: { recent: "Más recientes", severity: "Más severos" },
    panel: {
      contained: "Contención",
      useCase: "Caso de uso",
      severity: "Severidad",
      verdict: "Veredicto",
      tag: "Etiqueta",
      sort: "Orden",
    },
    clear: "Limpiar filtros",
    empty: "Ningún incidente coincide con estos filtros.",
    alerts: (n: number) => `${n} alertas · `,
  },

  incident: {
    loadError: "No se pudo cargar el incidente",
    notFound: "Incidente no encontrado",
    title: (id: number) => `Incidente #${id}`,
    rules: (rules: string[]) => `${rules.length > 1 ? "Reglas" : "Regla"} ${rules.map((r) => `#${r}`).join(", ")}`,
    detected: "Detectado",
    groupedAlerts: "Alertas agrupadas",
    groupedValue: (n: number) => `${n} alertas del mismo ataque`,
    intel: "Inteligencia de amenazas",
    noIntel: "Todavía no hay inteligencia de amenazas para esta IP.",
    vt: (malicious: number, suspicious: number, harmless: number) =>
      `${malicious} maliciosos · ${suspicious} sospechosos · ${harmless} inofensivos`,
    abuse: (score: number, reports: number) => `${score}% de confianza de abuso · ${reports} reportes`,
    autoContained: "Contenido automáticamente",
    autoFailed: "Falló la respuesta automática: requiere acción",
    simulation: (blockIp: boolean) => `Simulación: ${blockIp ? "bloquearía esta IP" : "aislaría este host"}`,
    policy: (name: string) => `Política: ${name}`,
    automation: (reason: string) => `Automatización: ${reason}`,
    showMore: "Ver todo",
    showLess: "Ver menos",
    closedTitle: "Caso cerrado",
    closedBy: (actor: string | null, at: string) => `por ${actor} · ${formatDate(at)}`,
    reopen: "Reabrir caso",
    reopenPlaceholder: "¿Por qué se reabre? (10 caracteres o más)",
    reopenConfirm: "Reabrir",
    reopenError: "No se pudo reabrir el caso",
    alreadyMitigated: "Ya mitigado",
    mitigatedAt: (status: IncidentStatus, at: string) =>
      `${
        ({ blocked: "Esta IP se bloqueó", isolated: "Este host se aisló", quarantined: "El correo se puso en cuarentena" } as Partial<
          Record<IncidentStatus, string>
        >)[status] ?? "Se contuvo"
      } el ${formatDate(at)}.`,
    recommendationTitle: "Recomendación automática",
    recommendationBlock: (severity: string, host: string) =>
      `Esta IP disparó una regla de severidad ${severity} contra ${host}.`,
    recommendationIsolate: (severity: string, host: string) =>
      `${host} disparó una regla de severidad ${severity}. Aislarlo corta todo su tráfico de red, salvo el canal con el manager de Wazuh.`,
    recommendationQuarantine: (severity: string, reporters: number) =>
      `${reporters === 1 ? "Una persona reportó" : `${reporters} personas reportaron`} este correo (severidad ${severity}). La cuarentena lo saca de todos los buzones donde llegó y se puede deshacer.`,
    recommendedAction: "Acción recomendada:",
    readOnly: "Acceso de solo lectura: un analista tiene que ejecutar esta acción.",
    closeCase: "Cerrar caso",
    alerts: (n: number) => `Alertas (${n})`,
    alertRule: (ruleId: string, grouped: boolean) => `Regla #${ruleId}${grouped ? " (agrupada)" : ""}`,
    vtEngines: (n: number) => `${n} motores de VirusTotal`,
    auditLog: (n: number) => `Registro de auditoría (${n})`,
  },

  // CU-03: tarjeta de cada correo de la campana.
  email: {
    title: (n: number) => (n > 1 ? `Correos de la campaña (${n})` : "Correo reportado"),
    subject: "Asunto",
    noSubject: "(sin asunto)",
    from: "Remitente",
    replyTo: "Responder a",
    replyToDiffers: "distinto del remitente: típico de phishing",
    reportedBy: "Reportado por",
    links: "Enlaces",
    attachments: "Adjuntos",
    vt: (n: number | null | undefined) =>
      n == null
        ? "sin datos de VirusTotal"
        : n === 1
        ? "1 motor de VirusTotal lo marca"
        : n > 1
        ? `${n} motores de VirusTotal lo marcan`
        : "VirusTotal: sin detecciones",
    // Alerta de la linea de tiempo en CU-03 (no hay regla de Wazuh).
    reportAlert: (grouped: boolean) => `Reporte de un usuario${grouped ? " (agrupado)" : ""}`,
    status: {
      pending: "Pendiente",
      quarantined: "En cuarentena",
      restored: "Restaurado",
      dismissed: "Descartado",
    } as Record<IncidentEmail["status"], string>,
    mailboxes: (list: string[]) => `Buzones: ${list.join(", ")}`,
    // Busqueda de correos similares de la campana.
    similarTitle: (n: number) => `Posibles correos de la misma campaña${n ? ` (${n})` : ""}`,
    noSimilar: "No se encontraron otros correos con los mismos indicadores.",
    search: "Buscar de nuevo",
    searching: "Buscando...",
    searchDone: (found: number, scanned: number) =>
      found ? `${found} correo(s) nuevo(s) de la campaña entre ${scanned} revisado(s).` : `Ningún correo nuevo entre ${scanned} revisado(s).`,
    searchError: "No se pudo buscar correos similares",
    dismiss: "Descartar",
    dismissTitle: "Descartar correo",
    dismissBody: "¿No es parte de la campaña? Queda registrado y no se pone en cuarentena.",
    dismissError: "No se pudo descartar el correo",
    matchedBy: (reasons: string[]) => `Coincide en: ${reasons.join(" · ")}`,
    reason: {
      attachment: "mismo adjunto",
      url: "mismo enlace",
      urlDomain: "mismo dominio de enlace",
      replyTo: "mismo Responder a",
      sendingIp: "misma IP de envío",
      from: "mismo remitente",
      fromDomain: "mismo dominio del remitente",
      subject: "asunto parecido",
    } as Record<string, string>,
    quarantineCount: (n: number) => `PONER EN CUARENTENA (${n})`,
    count: (n: number) => `${n} correos`,
  },

  confirm: {
    title: "Confirmar acción",
  },

  mitigation: {
    executing: "Ejecutando la mitigación...",
    failed: "La mitigación falló",
  },

  success: {
    title: "Mitigación completada",
    elapsed: "Tiempo de ejecución",
    seconds: (s: string) => `${s} segundos`,
    closeCase: "Cerrar caso",
    viewIncident: "Ver incidente",
  },

  profile: {
    loadError: "No se pudo cargar el perfil",
    noSession: "No hay una sesión iniciada",
    title: "Perfil",
    subtitle: "Datos de la cuenta",
    logoutTitle: "Cerrar sesión",
    logoutBody: "¿Seguro que querés cerrar sesión?",
    logout: "Cerrar sesión",
    deleteTitle: "Eliminar cuenta",
    deleteBody:
      "Tu perfil (nombre y email) se va a eliminar de forma permanente. Los registros de auditoría de seguridad se conservan, pero anonimizados: ya no te identifican. No se puede deshacer.",
    delete: "Eliminar",
    deleteError: "No se pudo eliminar la cuenta",
    invalidData: "Datos inválidos",
    required: "El nombre y el email son obligatorios.",
    updateError: "No se pudo actualizar el perfil",
    edit: "Editar perfil",
    automation: "Automatización",
    manageUsers: "Gestionar usuarios",
    privacy: "Política de privacidad",
  },

  users: {
    title: "Usuarios",
    subtitle: "Aprobá registros y gestioná los accesos",
    loadError: "No se pudieron cargar los usuarios",
    sections: { pending: "Pendientes de aprobación", active: "Activos", disabled: "Desactivados" },
    section: (title: string, n: number) => `${title} (${n})`,
    notAllowed: "Acción no permitida",
    rejectTitle: "Rechazar registro",
    removeTitle: "Eliminar usuario",
    removeBody: (username: string) =>
      `${username} se va a eliminar. Sus registros de auditoría se conservan, anonimizados.`,
    reject: "Rechazar",
    remove: "Eliminar",
    approve: "Aprobar",
    enable: "Activar",
    disable: "Desactivar",
    you: "  (vos)",
    confirmRemove: (username: string) => `Confirmá para eliminar a ${username}`,
    confirmApprove: (username: string) => `Confirmá para aprobar a ${username}`,
    confirmRole: (role: string) => `Confirmá el cambio de rol a ${role}`,
    confirmStatus: (enable: boolean, username: string) =>
      `Confirmá para ${enable ? "activar" : "desactivar"} a ${username}`,
  },

  close: {
    loadError: "No se pudo cargar el incidente",
    title: (id: number) => `Cerrar incidente #${id}`,
    verdict: "Veredicto",
    tags: "Etiquetas",
    lockedTags: "Las etiquetas que puso el sistema no se pueden quitar.",
    note: (required: boolean, min: number) => `Nota${required ? ` (obligatoria, ${min} caracteres o más)` : " (opcional)"}`,
    notePlaceholder: "¿Por qué se cierra el caso? Ej.: escaneo autorizado, ticket INF-2231",
    submitting: "Cerrando...",
    submit: "Cerrar caso",
    falsePositiveHelp: "Cerrar como falso positivo requiere confirmación biométrica.",
    confirmFalsePositive: "Confirmá para cerrar como falso positivo",
    error: "No se pudo cerrar el caso",
  },

  activity: {
    title: "Actividad",
    subtitle: "Eventos recientes del sistema",
    loadError: "No se pudo cargar la actividad",
    empty: "Todavía no hay actividad.",
    incidentRef: (id: number) => ` · incidente #${id}`,
    categories: {
      all: "Todo",
      incidents: "Incidentes",
      response: "Respuesta",
      automation: "Automatización",
      access: "Acceso",
      users: "Usuarios",
    },
  },

  automation: {
    title: "Automatización",
    subtitle: "Respuesta automática según el contexto",
    loadError: "No se pudo cargar la configuración de la automatización",
    readOnly: "Solo lectura: únicamente un administrador puede cambiar la automatización.",
    modes: {
      off: { label: "Apagada", help: "Cada incidente espera a un analista." },
      simulate: { label: "Simulación", help: "Las políticas se evalúan y se registran, pero no se ejecuta nada." },
      active: { label: "Activa", help: "Los incidentes que coinciden se contienen automáticamente." },
    } as Record<AutomationMode, { label: string; help: string }>,
    conditions: {
      minSeverity: "Severidad ≥",
      minAbuseScore: "Puntaje de AbuseIPDB ≥",
      minVtMalicious: "Detecciones de VirusTotal (IP) ≥",
      minHashPositives: "Motores de VirusTotal (archivo) ≥",
      country: (countries: string[]) => `País en ${countries.join(", ")}`,
      maxAssetCriticality: "Criticidad del activo ≤",
      assetCriticality: (c: string) => `Criticidad del activo ≤ ${c}`,
    },
    notSaved: "Cambio no guardado",
    invalidValue: "Valor inválido",
    invalidThresholds: "Los umbrales tienen que ser números ≥ 0.",
    invalidBreaker: "Usá números enteros: acciones ≥ 1 y minutos ≥ 1.",
    confirmMode: (mode: string) => `Confirmá el modo de automatización: ${mode}`,
    enableTitle: "Activar la respuesta automática",
    enableBody:
      "Los incidentes que coincidan se van a contener sin esperar a un analista. Los activos críticos y las IPs de la lista de exclusión siempre quedan afuera.",
    enable: "Activar",
    confirmPolicy: (name: string) => `Confirmá los cambios en "${name}"`,
    confirmPolicyToggle: (enable: boolean, name: string) => `Confirmá para ${enable ? "activar" : "desactivar"} "${name}"`,
    confirmBreaker: "Confirmá el cambio del cortacircuitos",
    confirmAllowlist: "Confirmá el cambio de la lista de exclusión",
    confirmDefaultCriticality: (c: string) => `Confirmá la criticidad por defecto: ${c}`,
    confirmAsset: (name: string, c: string) => `Confirmá ${name} como ${c}`,
    mode: "Modo",
    neverContained: "Los activos críticos y las IPs de la lista de exclusión nunca se contienen automáticamente.",
    paused: "Pausada automáticamente por el cortacircuitos. Un administrador tiene que revisarla y volver a activarla.",
    lastChange: (by: string, at: string) => `Último cambio: ${by} · ${formatDate(at)}`,
    safetyLimits: "Límites de seguridad",
    breaker: "Cortacircuitos",
    breakerHelp: "Si la automatización ejecuta esta cantidad de acciones dentro de la ventana, pasa sola a Simulación.",
    maxActions: "Máximo de acciones automáticas",
    windowMinutes: "Ventana (minutos)",
    saveLimits: "Guardar límites",
    unknownAssets: "Activos fuera del inventario",
    unknownAssetsHelp: "Criticidad que se asume para los agentes desconocidos. Alta = no se automatiza sobre lo que no conocemos.",
    policies: "Políticas (gana la primera que coincide)",
    blockIp: "Bloquear IP",
    isolateHost: "Aislar host",
    editThresholds: "Editar umbrales",
    assets: "Activos",
    assetsHelp: (c: string) => `Los agentes que no están en la lista usan la criticidad por defecto (${c}).`,
    agent: (id: string) => `· agente ${id}`,
    allowlist: "Lista de exclusión (nunca se bloquean)",
    allowlistPlaceholder: "Ej.: 10.0.0.0/8, 203.0.113.7",
    saveAllowlist: "Guardar lista",
    precision: {
      contained: "Contenidos",
      simulated: "Simulados",
      closed: (n: number) => `cerrados ${n}`,
      precision: "precisión",
      // VP / BP / FP: verdadero, benigno y falso positivo.
      counts: (tp: number, bp: number, fp: number) => `(${tp} VP · ${bp} BP · ${fp} FP)`,
      none: "Todavía no hay casos.",
    },
  },

  // Aviso de privacidad (Ley 25.326, art. 6). Lo que dice tiene que coincidir
  // con lo implementado en orchestrator/src/privacy.js (supresion,
  // seudonimizacion, retencion).
  privacy: {
    title: "Política de privacidad",
    subtitle: "Protección de datos personales — Ley Nº 25.326",
    sections: [
      {
        title: "Responsable y finalidad",
        body: [
          "Micro-SOAR trata datos personales con una única finalidad: la detección y respuesta a incidentes de seguridad informática por parte del equipo de seguridad que opera la plataforma.",
          "Responsable de la base de datos: Fortia Micro-SOAR.",
        ],
      },
      {
        title: "Qué datos se tratan",
        body: [
          "Del analista: usuario, nombre, email y rol; y el registro de auditoría de las acciones que ejecuta (inicio de sesión, bloqueo de IP, aislamiento de equipos), con fecha y hora. Este registro es necesario para la trazabilidad de las acciones críticas de seguridad.",
          "En el dispositivo: el token de sesión, guardado en el almacenamiento seguro del sistema operativo.",
          "Biometría: la huella o el rostro los valida el sistema operativo del celular. Micro-SOAR no recibe, guarda ni transmite datos biométricos.",
          "De terceros: la dirección IP de origen de un ataque detectado, que puede identificar a una persona. Se usa solo para contener el ataque.",
        ],
      },
      {
        title: "Destinatarios y transferencias",
        body: [
          "La IP de origen de un ataque se consulta en servicios de reputación de amenazas (VirusTotal y AbuseIPDB) para evaluar su riesgo.",
          "La plataforma se aloja en Amazon Web Services (región us-east-1, Estados Unidos).",
          "Los datos no se ceden a terceros con otra finalidad.",
        ],
      },
      {
        title: "Plazo de conservación",
        body: [
          "Las IPs de origen de los ataques se enmascaran (se conserva solo la red, por ejemplo 203.0.113.0/24) y se descarta la información de reputación asociada a los 90 días del incidente.",
          "El perfil del analista se conserva mientras la cuenta exista.",
        ],
      },
      {
        title: "Tus derechos",
        body: [
          "Acceso y rectificación: podés ver y editar tu nombre y email desde Perfil.",
          "Supresión: desde Perfil → \"Eliminar cuenta\" eliminás tu perfil. El registro de auditoría de seguridad no se borra, pero se anonimiza: deja de identificarte.",
        ],
      },
      {
        title: "Información legal",
        body: [
          "El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326.",
          "La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.",
        ],
      },
    ],
  },
};
