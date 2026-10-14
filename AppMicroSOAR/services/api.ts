import { http } from './http';
import type { ActivityItem, Incident, Role, UserProfile, UserStatus } from '../types';

export const getIncidents = async (): Promise<{ data: Incident[] }> => {
  const { data } = await http.get<Incident[]>('/api/v1/incidents');
  return { data };
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

export const getAuditEvents = async (): Promise<ActivityItem[]> => {
  const { data } = await http.get<ActivityItem[]>('/api/v1/audit');
  return data;
};
