import { http } from './http';
import { saveToken } from './tokenStore';
import { userSeed } from '../data/user';

export const signIn = async (username: string, password: string) => {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const { data } = await http.post<{ token: string }>('/api/v1/auth/login', { username, password });
  await saveToken(data.token);

  return { user: userSeed, token: data.token };
};

export const signUp = async (name: string, email: string, password: string) => {
  if (!name || !email || !password) {
    throw new Error('Please complete all fields');
  }

  return { user: { ...userSeed, name, email }, token: 'demo-token' };
};
