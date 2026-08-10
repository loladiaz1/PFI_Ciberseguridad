import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";

// Pasos que se muestran uno por uno mientras "corre" la mitigación
const STEPS = [
  "Connecting to Wazuh...",
  "Blocking malicious IP...",
  "Updating firewall...",
  "Saving audit log...",
];

const STEP_DELAY = 700; // ms entre cada mensaje
const RESULT_DELAY = 600; // pausa después del último mensaje antes de mostrar el resultado
const REDIRECT_DELAY = 1800; // cuánto se queda la pantalla de resultado antes de navegar

// TODO: reemplazar por el resultado real que devuelva tu API / acción de mitigación
const MOCK_SUCCESS = true;

// Colores propios para no depender de que existan en styles/colors.ts
const SUCCESS_COLOR = "#16a34a";
const ERROR_COLOR = "#dc2626";

export default function LoadingScreen() {
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [result, setResult] = useState<"pending" | "success" | "error">("pending");

  // Va revelando los mensajes de a uno
  useEffect(() => {
    if (visibleSteps < STEPS.length) {
      const timer = setTimeout(() => {
        setVisibleSteps((v) => v + 1);
      }, STEP_DELAY);
      return () => clearTimeout(timer);
    }

    const resultTimer = setTimeout(() => {
      setResult(MOCK_SUCCESS ? "success" : "error");
    }, RESULT_DELAY);
    return () => clearTimeout(resultTimer);
  }, [visibleSteps]);

  // Una vez que hay resultado, redirige después de un rato
  useEffect(() => {
    if (result === "pending") return;
    const redirectTimer = setTimeout(() => {
      router.replace("/success");
    }, REDIRECT_DELAY);
    return () => clearTimeout(redirectTimer);
  }, [result]);

  if (result !== "pending") {
    const isSuccess = result === "success";
    return (
      <View
        style={[
          styles.resultContainer,
          { backgroundColor: isSuccess ? SUCCESS_COLOR : ERROR_COLOR },
        ]}
      >
        <MaterialCommunityIcons
          name={isSuccess ? "check-circle" : "close-circle"}
          size={110}
          color="#fff"
        />
        <Text style={styles.resultTitle}>
          {isSuccess ? "Amenaza neutralizada" : "No se pudo bloquear la IP"}
        </Text>
        <Text style={styles.resultSubtitle}>
          {isSuccess
            ? "La IP maliciosa fue bloqueada y el incidente quedó registrado."
            : "Ocurrió un error al aplicar la mitigación. Reintentá o contactá al equipo."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <BrandHeader logoSize={96} />

        <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />

        <Text style={styles.title}>Executing Mitigation...</Text>

        <View style={styles.stepsWrap}>
          {visibleSteps > 0 && (
            <Text style={styles.text}>{STEPS[visibleSteps - 1]}</Text>
          )}
        </View>
      </View>

      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  spinner: {
    marginTop: 20,
  },

  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginVertical: 20,
    color: Colors.text,
  },

  stepsWrap: {
    minHeight: STEPS.length * 26,
    alignItems: "center",
  },

  text: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontSize: 15,
  },

  resultContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },

  resultTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#fff",
    marginTop: 20,
    textAlign: "center",
  },

  resultSubtitle: {
    fontSize: 15,
    color: "rgba(255,255,255,0.9)",
    marginTop: 10,
    textAlign: "center",
    lineHeight: 22,
  },
});