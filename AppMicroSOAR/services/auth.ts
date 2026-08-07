import { userSeed } from '../data/user';

export const signIn = async (email: string, password: string) => {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  return { user: userSeed, token: 'demo-token' };
};

export const signUp = async (name: string, email: string, password: string) => {
  if (!name || !email || !password) {
    throw new Error('Please complete all fields');
  }

  return { user: { ...userSeed, name, email }, token: 'demo-token' };
};
