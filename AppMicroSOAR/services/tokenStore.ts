import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'microsoar_token';

export const saveToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);
