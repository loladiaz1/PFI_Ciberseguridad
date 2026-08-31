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
    const isLoginRequest = error.config?.url?.includes('/auth/login');

    // Un 401 en el login es "credenciales invalidas", no "sesion vencida" --
    // no hay token que limpiar ni sesion de la que echar a nadie. Redirigir
    // a "/" aca remonta la pantalla de login (ya estamos ahi) y borra el
    // estado de error local antes de que el componente llegue a mostrarlo.
    if (error.response?.status === 401 && !isLoginRequest) {
      await clearToken();
      router.replace('/');
    }
    return Promise.reject(error);
  }
);
