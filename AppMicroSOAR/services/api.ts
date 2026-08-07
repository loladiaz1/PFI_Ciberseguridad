import { incidentsSeed } from '../data/incidents';
import type { Incident } from '../types';

export const getIncidents = async (): Promise<{ data: Incident[] }> => ({
  data: incidentsSeed,
});

export const getIncidentById = async (id: string): Promise<{ data?: Incident }> => ({
  data: incidentsSeed.find((incident) => incident.id === id),
});
