import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import Colors from "../styles/colors";
import { BrandHeader } from "../components/ui/BrandHeader";

// Pantalla genérica de verificación biométrica.
// Se navega a ella pasando dos params por query:
//  - redirect: a dónde ir si la verificación es exitosa (ej "/dashboard", "/loading")
//  - fallback: a dónde ir si el usuario cancela (ej "/login", "/confirm")
//
// Ejemplo de uso:
// router.push({ pathname: "/biometric", params: { redirect: "/dashboard", fallback: "/login" } });

export default function BiometricScreen() {
  const params = useLocalSearchParams<{ redirect?: string; fallback?: string }>();
  const redirectTo = (typeof params.redirect === "string" ? params.redirect : "/dashboard") as Href;
  const fallbackTo = (typeof params.fallback === "string" ? params.fallback : "/") as Href;

  const [biometricType, setBiometricType] = useState<"face" | "fingerprint" | "generic">("generic");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Detecta qué tipo de biometría soporta el dispositivo (Face ID en iPhone, huella en Android, etc.)
  useEffect(() => {
    (async () => {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricType("face");
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricType("fingerprint");
      }
    })();
  }, []);

  const handleVerify = async () => {
    setStatus("checking");
    setErrorMessage("");

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    // Si el dispositivo no tiene biometría configurada, no lo trabamos:
    // dejamos pasar. Cuando haya backend, esto se puede reforzar con password.
    if (!hasHardware || !isEnrolled) {
      router.replace(redirectTo);
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirmá tu identidad",
      cancelLabel: "Cancelar",
      disableDeviceFallback: false,
    });

    if (result.success) {
      router.replace(redirectTo);
    } else {
      setStatus("error");
      setErrorMessage("No se pudo verificar. Intentá de nuevo.");
    }
  };

  const icon = biometricType === "face" ? "face-recognition" : "fingerprint";
  const label =
    biometricType === "face"
      ? "Face ID"
      : biometricType === "fingerprint"
      ? "Huella digital"
      : "Verificación biométrica";

  return (
    <View style={styles.container}>
      <BrandHeader logoSize={96} />

      <View style={styles.content}>
        <MaterialCommunityIcons name={icon} size={110} color={Colors.primary} />

        <Text style={styles.title}>{label}</Text>
        <Text style={styles.subtitle}>
          Necesitamos verificar tu identidad para continuar
        </Text>

        {status === "error" && <Text style={styles.error}>{errorMessage}</Text>}

        <TouchableOpacity style={styles.button} onPress={handleVerify} disabled={status === "checking"}>
          <Text style={styles.buttonText}>
            {status === "checking" ? "Verificando..." : "Confirmar"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace(fallbackTo)}>
          <Text style={styles.cancel}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 60,
  },

  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },

  title: {
    fontSize: 24,
    fontWeight: "800",
    color: Colors.text,
    marginTop: 20,
  },

  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 22,
  },

  error: {
    color: Colors.danger,
    marginTop: 16,
    textAlign: "center",
  },

  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 14,
    marginTop: 36,
  },

  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },

  cancel: {
    color: Colors.textSecondary,
    marginTop: 18,
    fontSize: 15,
  },
});