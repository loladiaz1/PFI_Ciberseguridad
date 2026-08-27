import { incidentsSeed } from '../data/incidents';
import type { Incident } from '../types';

export const API_URL = "http://192.168.100.64:3000";

export const getIncidents = async (): Promise<{ data: Incident[] }> => ({
  data: incidentsSeed,
});

export const updateUser = async (
  id: number,
  data: {
    name: string;
    email: string;
    role: string;
    avatarUrl?: string | null;
  }
) => {
  const response = await fetch(`${API_URL}/api/users/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  const text = await response.text();

  let result: any = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = {};
  }

  if (!response.ok) {
    throw new Error(
      result.message || "Unable to update your profile."
    );
  }

  return result;
};