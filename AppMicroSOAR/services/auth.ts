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

export const signUp = async (name: string, email: string, password: string) => {
  if (!name || !email || !password) {
    throw new Error('Please complete all fields');
  }

  // Mock: no hay endpoint de registro real todavia (MVP, un solo usuario
  // fijo por env vars en el backend). No guarda sesion -- ver register.tsx.
  return { user: { name, email } };
};

export const getStoredUser = async (): Promise<UserProfile> => {
  const { data } = await http.get<UserProfile>('/api/v1/me');
  return data;
};
