import { incidentsSeed } from '../data/incidents';
import type { Incident } from '../types';

export const API_URL = "http://10.100.111.246:3000";

export const getIncidents = async (): Promise<{ data: Incident[] }> => ({
  data: incidentsSeed,
});

export const getIncidentById = async (
  id: string
): Promise<{ data?: Incident }> => ({
  data: incidentsSeed.find((incident) => incident.id === id),
});