import { API_URL } from './api';

export type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
};

export type AuthResponse = {
  user: User;
  token: string;
};

export const signIn = async (
  email: string,
  password: string
): Promise<AuthResponse> => {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Login failed');
  }

  return data;
};

export const signUp = async (
  name: string,
  email: string,
  password: string
): Promise<AuthResponse> => {
  if (!name || !email || !password) {
    throw new Error('Please complete all fields');
  }

  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      email,
      password,
      role: 'OPERATOR',
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Registration failed');
  }

  return data;
};