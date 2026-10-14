export type IncidentStatus = 'new' | 'blocked' | 'isolated';

// CU-01 (fuerza bruta, hay IP atacante) -> block-ip.
// CU-02 (malware en el host, sin IP atacante) -> isolate-host.
export type MitigationAction = 'block-ip' | 'isolate-host';

export interface Incident {
  id: number;
  source: string;
  ruleId: string;
  severity: number;
  ruleDescription: string | null;
  srcIp: string | null;
  hostname: string;
  agentId: string;
  timestamp: string;
  status: IncidentStatus;
  blockedAt: string | null;
  isolatedAt: string | null;
  // JSON serializado por el backend (orchestrator/src/enrichment.js).
  enrichmentVt: string | null;
  enrichmentAbuseIpdb: string | null;
  // Agrupamiento: alertas del mismo ataque sumadas a este incidente.
  alertCount: number;
  ruleIds: string | null; // JSON con todas las reglas; null = solo ruleId
  hashPositives: number | null;
  // Decision de la automatizacion (orchestrator/src/automation.js).
  automationDecision: 'none' | 'simulated' | 'executed' | 'failed' | null;
  automationPolicy: string | null;
  automationReason: string | null;
}

export interface ActivityItem {
  id: number;
  type: string;
  detail: string;
  createdAt: string;
}

export type Role = 'admin' | 'analyst' | 'auditor';

export type AutomationMode = 'off' | 'simulate' | 'active';
export type Criticality = 'low' | 'medium' | 'high' | 'critical';

export interface PolicyConditions {
  minSeverity?: number;
  minAbuseScore?: number;
  minVtMalicious?: number;
  minHashPositives?: number;
  fromCountries?: string[];
  maxAssetCriticality?: Criticality;
}

export interface AutomationPolicy {
  id: number;
  key: string;
  name: string;
  order: number;
  enabled: boolean;
  useCase: 'CU-01' | 'CU-02';
  action: 'block-ip' | 'isolate-host';
  conditions: PolicyConditions;
}

export interface Asset {
  agentId: string;
  name: string;
  criticality: Criticality;
}

export interface AutomationConfig {
  settings: { mode: AutomationMode; allowlist: string[]; defaultCriticality: Criticality; updatedBy: string | null; updatedAt: string };
  policies: AutomationPolicy[];
  assets: Asset[];
}
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface UserProfile {
  id: number;
  username: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}
