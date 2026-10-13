import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'microsoar_token';

// Cache en memoria ademas de SecureStore: en Android, leer justo despues de
// escribir en el keystore encriptado puede no estar listo todavia (race
// condition real -- causaba un 401 en la primera request post-login, que
// el interceptor de http.ts interpreta como sesion invalida y manda de
// vuelta al login). La memoria es la fuente de verdad mientras la app esta
// abierta; SecureStore solo hace falta para sobrevivir a un restart.
let memoryToken: string | null = null;

export const saveToken = async (token: string) => {
  memoryToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

export const getToken = async (): Promise<string | null> => {
  if (memoryToken !== null) {
    return memoryToken;
  }
  const stored = await SecureStore.getItemAsync(TOKEN_KEY);
  memoryToken = stored;
  return stored;
};

export const clearToken = async () => {
  memoryToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};
