export type IncidentStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  owner: string;
  updatedAt: string;
  description?: string;
  location?: string;
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
