import { http } from './http';
import type { ActivityItem, Incident, UserProfile } from '../types';

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

export const updateUser = async (fields: { name: string; email: string }): Promise<UserProfile> => {
  const { data } = await http.put<UserProfile>('/api/v1/me', fields);
  return data;
};

export const getAuditEvents = async (): Promise<ActivityItem[]> => {
  const { data } = await http.get<ActivityItem[]>('/api/v1/audit');
  return data;
};
