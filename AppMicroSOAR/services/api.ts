import { http } from './http';
import type {
  ActivityItem,
  Asset,
  AuditCategory,
  ClosureCatalog,
  AutomationConfig,
  AutomationMode,
  Criticality,
  Incident,
  IncidentFilters,
  PolicyConditions,
  Role,
  TimelineEntry,
  UserProfile,
  UserStatus,
  Verdict,
} from '../types';

// Filtros opcionales y combinables (los aplica el backend).
export const getIncidents = async (filters: IncidentFilters = {}): Promise<{ data: Incident[] }> => {
  const { data } = await http.get<Incident[]>('/api/v1/incidents', { params: filters });
  return { data };
};

export const getClosureCatalog = async (): Promise<ClosureCatalog> => {
  const { data } = await http.get<ClosureCatalog>('/api/v1/closure-catalog');
  return data;
};

export const closeIncident = async (
  id: number,
  closure: { verdict: Verdict; tags: string[]; note?: string }
): Promise<Incident> => {
  const { data } = await http.post<Incident>(`/api/v1/incidents/${id}/close`, closure);
  return data;
};

export const reopenIncident = async (id: number, note: string): Promise<Incident> => {
  const { data } = await http.post<Incident>(`/api/v1/incidents/${id}/reopen`, { note });
  return data;
};

export const getIncidentById = async (id: number): Promise<{ data?: Incident }> => {
  const { data } = await http.get<Incident>(`/api/v1/incidents/${id}`);
  return { data };
};

export interface BlockIpResult {
  incidentId: number;
  srcIp: string;
  agentId: string;
  status: string;
}

export const blockIncidentIp = async (id: number): Promise<BlockIpResult> => {
  const { data } = await http.post<BlockIpResult>(`/api/v1/incidents/${id}/actions/block-ip`);
  return data;
};

export interface IsolateHostResult {
  incidentId: number;
  hostname: string;
  agentId: string;
  status: string;
}

export const isolateIncidentHost = async (id: number): Promise<IsolateHostResult> => {
  const { data } = await http.post<IsolateHostResult>(`/api/v1/incidents/${id}/actions/isolate-host`);
  return data;
};

// CU-03: cuarentena / restauracion de los correos de la campana. Sin
// messageIds, todos los del incidente.
export const quarantineIncidentEmail = async (id: number, messageIds?: number[]): Promise<{ status: string }> => {
  const { data } = await http.post(`/api/v1/incidents/${id}/actions/quarantine-email`, messageIds ? { messageIds } : {});
  return data;
};

export const restoreIncidentEmail = async (id: number, messageIds?: number[]): Promise<{ status: string }> => {
  const { data } = await http.post(`/api/v1/incidents/${id}/actions/restore-email`, messageIds ? { messageIds } : {});
  return data;
};

export const updateUser = async (fields: { name: string; email: string }): Promise<UserProfile> => {
  const { data } = await http.put<UserProfile>('/api/v1/me', fields);
  return data;
};

// Derecho de supresion (Ley 25.326): borra el perfil y seudonimiza la
// auditoria del usuario en el backend.
export const deleteAccount = async (): Promise<void> => {
  await http.delete('/api/v1/me');
};

// Gestion de usuarios (solo admin; el backend devuelve 403 a otros roles).
export const getUsers = async (): Promise<UserProfile[]> => {
  const { data } = await http.get<UserProfile[]>('/api/v1/users');
  return data;
};

export const updateUserAccess = async (
  username: string,
  changes: { role?: Role; status?: Exclude<UserStatus, 'pending'> }
): Promise<UserProfile> => {
  const { data } = await http.patch<UserProfile>(`/api/v1/users/${encodeURIComponent(username)}`, changes);
  return data;
};

export const removeUser = async (username: string): Promise<void> => {
  await http.delete(`/api/v1/users/${encodeURIComponent(username)}`);
};

// Automatizacion: cualquier rol la lee; solo un admin la cambia (el backend
// devuelve 403 a los demas).
export const getAutomation = async (): Promise<AutomationConfig> => {
  const { data } = await http.get<AutomationConfig>('/api/v1/automation');
  return data;
};

export const updateAutomationSettings = async (changes: {
  mode?: AutomationMode;
  allowlist?: string[];
  defaultCriticality?: Criticality;
  maxActions?: number;
  windowMinutes?: number;
}): Promise<AutomationConfig> => {
  const { data } = await http.put<AutomationConfig>('/api/v1/automation/settings', changes);
  return data;
};

export const updatePolicy = async (
  id: number,
  changes: { enabled?: boolean; conditions?: PolicyConditions }
): Promise<AutomationConfig> => {
  const { data } = await http.put<AutomationConfig>(`/api/v1/automation/policies/${id}`, changes);
  return data;
};

export const updateAsset = async (agentId: string, criticality: Criticality): Promise<Asset> => {
  const { data } = await http.put<Asset>(`/api/v1/assets/${encodeURIComponent(agentId)}`, { criticality });
  return data;
};

// Auditoria, opcionalmente filtrada por categoria o por incidente.
export const getAuditEvents = async (
  filters: { category?: AuditCategory; incidentId?: number } = {}
): Promise<ActivityItem[]> => {
  const { data } = await http.get<ActivityItem[]>('/api/v1/audit', { params: filters });
  return data;
};

export const getIncidentTimeline = async (id: number): Promise<TimelineEntry[]> => {
  const { data } = await http.get<TimelineEntry[]>(`/api/v1/incidents/${id}/timeline`);
  return data;
};
