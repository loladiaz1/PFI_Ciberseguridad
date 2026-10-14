import { http } from './http';
import { saveToken } from './tokenStore';
import type { UserProfile } from '../types';

export const signIn = async (username: string, password: string) => {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const { data } = await http.post<{ token: string }>('/api/v1/auth/login', { username, password });
  await saveToken(data.token);

  return { token: data.token };
};

// Registro con aprobacion: la cuenta queda "pending" hasta que un admin la
// activa. El email es tambien el nombre de usuario para el login.
export const signUp = async (name: string, email: string, password: string) => {
  if (!name || !email || !password) {
    throw new Error('Please complete all fields');
  }

  const { data } = await http.post<{ username: string; status: string }>('/api/v1/auth/register', {
    username: email,
    name,
    email,
    password,
  });
  return data;
};

export const getStoredUser = async (): Promise<UserProfile> => {
  const { data } = await http.get<UserProfile>('/api/v1/me');
  return data;
};
