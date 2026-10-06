export type IncidentStatus = 'new' | 'blocked';

export interface Incident {
  id: number;
  source: string;
  ruleId: string;
  severity: number;
  ruleDescription: string | null;
  srcIp: string;
  hostname: string;
  agentId: string;
  timestamp: string;
  status: IncidentStatus;
  blockedAt: string | null;
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
