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
}

export interface ActivityItem {
  id: number;
  type: string;
  detail: string;
  createdAt: string;
}

export interface UserProfile {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
}
