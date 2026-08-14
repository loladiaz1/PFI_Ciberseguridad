import { http } from './http';
import type { Incident } from '../types';

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
