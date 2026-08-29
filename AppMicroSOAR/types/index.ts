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
  id: string;
  title: string;
  timestamp: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}
