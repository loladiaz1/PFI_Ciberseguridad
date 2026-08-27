import { API_URL } from "./api";
import * as SecureStore from "expo-secure-store";

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

// ======================================
// CLAVES DE SESIÓN
// ======================================

const USER_KEY = "fortia_user";
const TOKEN_KEY = "fortia_token";

// ======================================
// GUARDAR SESIÓN
// ======================================

export const saveSession = async (
  user: User,
  token: string
) => {
  await SecureStore.setItemAsync(
    USER_KEY,
    JSON.stringify(user)
  );

  await SecureStore.setItemAsync(
    TOKEN_KEY,
    token
  );
};

// ======================================
// OBTENER USUARIO ACTUAL
// ======================================

export const getStoredUser = async (): Promise<User | null> => {
  try {
    const user = await SecureStore.getItemAsync(USER_KEY);

    if (!user) {
      return null;
    }

    return JSON.parse(user) as User;
  } catch (error) {
    console.error("Error reading stored user:", error);
    return null;
  }
};

// ======================================
// OBTENER TOKEN
// ======================================

export const getStoredToken = async (): Promise<string | null> => {
  return await SecureStore.getItemAsync(TOKEN_KEY);
};

// ======================================
// CERRAR SESIÓN
// ======================================

export const clearSession = async () => {
  await SecureStore.deleteItemAsync(USER_KEY);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};

// ======================================
// MANEJO DE RESPUESTAS DEL BACKEND
// ======================================

const parseResponse = async (response: Response) => {
  const text = await response.text();

  let data: any = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    let message = "Something went wrong.";

    if (typeof data.message === "string") {
      message = data.message;
    } else if (typeof data.error === "string") {
      message = data.error;
    } else if (response.status === 409) {
      message = "An account with this email already exists.";
    } else if (response.status === 401) {
      message = "Invalid email or password.";
    } else if (response.status >= 500) {
      message = "Server error. Please try again later.";
    }

    throw new Error(message);
  }

  return data;
};

// ======================================
// LOGIN
// ======================================

export const signIn = async (
  email: string,
  password: string
): Promise<AuthResponse> => {
  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  try {
    const response = await fetch(
      `${API_URL}/api/auth/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      }
    );

    const data = await parseResponse(response);

    // Guardamos automáticamente el usuario real
    await saveSession(
      data.user,
      data.token
    );

    return data;

  } catch (error) {

    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to the server. Please check your connection."
      );
    }

    throw error;
  }
};

// ======================================
// REGISTER
// ======================================

export const signUp = async (
  name: string,
  email: string,
  password: string
): Promise<AuthResponse> => {

  if (!name || !email || !password) {
    throw new Error(
      "Please complete all fields."
    );
  }

  try {

    const response = await fetch(
      `${API_URL}/api/auth/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
          role: "OPERATOR",
        }),
      }
    );

    const data = await parseResponse(response);

    // Guardamos automáticamente el usuario real
    await saveSession(
      data.user,
      data.token
    );

    return data;

  } catch (error) {

    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to the server. Please check your connection."
      );
    }

    throw error;
  }
};