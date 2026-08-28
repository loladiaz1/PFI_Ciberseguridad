import axios from 'axios';
import { router } from 'expo-router';
import { clearToken, getToken } from './tokenStore';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export const http = axios.create({ baseURL: API_BASE_URL });

http.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await clearToken();
      router.replace('/');
    }
    return Promise.reject(error);
  }
);
