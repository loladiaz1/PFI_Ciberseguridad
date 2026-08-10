import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";

import { router, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFonts, Roboto_400Regular, Roboto_600SemiBold, Roboto_700Bold } from "@expo-google-fonts/roboto";

import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";

// Fallback por si esta pantalla no recibe color de error definido en styles/colors.ts
const ERROR_COLOR = "#dc2626";

type Params = {
  status?: "success" | "error";
  ip?: string;
  target?: string;
  time?: string;
  reason?: string;
};

export default function SuccessScreen() {
  const params = useLocalSearchParams<Params>();

  const [fontsLoaded] = useFonts({
    Roboto_400Regular,
    Roboto_600SemiBold,
    Roboto_700Bold,
  });

  // Valores por defecto
  const isSuccess = params.status !== "error";
  const ip = params.ip ?? "185.220.101.55";
  const target = params.target ?? "SERVER-02";
  const time = params.time ?? "1.4 seconds";
  const reason = params.reason ?? "Connection to the firewall timed out";

  if (!fontsLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <BrandHeader />

        {/* STATUS ICON */}
        <MaterialCommunityIcons
          name={isSuccess ? "check-circle" : "close-circle"}
          size={90}
          color={isSuccess ? Colors.success : ERROR_COLOR}
          style={styles.icon}
        />

        {/* TITLE */}
        <Text style={styles.title}>
          {isSuccess ? "Mitigation Completed" : "Mitigation Failed"}
        </Text>

        {/* SUBTITLE */}
        <Text style={styles.subtitle}>
          {isSuccess
            ? "The malicious IP has been successfully blocked."
            : "The malicious IP could not be blocked. Manual action may be required."}
        </Text>

        {/* INFORMATION CARD */}
        <View style={[styles.card, !isSuccess && styles.cardError]}>
          <Text style={styles.label}>
            {isSuccess ? "Blocked IP" : "Target IP"}
          </Text>
          <Text style={styles.value}>{ip}</Text>

          <Text style={styles.label}>Target</Text>
          <Text style={styles.value}>{target}</Text>

          {isSuccess ? (
            <>
              <Text style={styles.label}>Execution Time</Text>
              <Text style={styles.value}>{time}</Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>Reason</Text>
              <Text style={[styles.value, styles.valueError]}>{reason}</Text>
            </>
          )}
        </View>

        {/* BACK BUTTON */}
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: isSuccess ? Colors.success : ERROR_COLOR },
          ]}
          onPress={() => router.replace("/dashboard")}
        >
          <Text style={styles.buttonText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </ScrollView>

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
    flexGrow: 1,
    padding: 25,
    paddingTop: 35,
    paddingBottom: 110,
  },

  // =========================
  // FORTIA BRAND
  // =========================
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginLeft: -12,
    marginBottom: 15,
  },

  brandName: {
    fontSize: 34,
    fontFamily: "Roboto_700Bold",
    color: "#f97316",
    marginLeft: 4,
  },

  // =========================
  // STATUS ICON
  // =========================
  icon: {
    alignSelf: "center",
    marginTop: 10,
  },

  // =========================
  // TITLE
  // =========================
  title: {
    fontSize: 30,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 15,
    color: Colors.text,
  },

  subtitle: {
    textAlign: "center",
    marginVertical: 20,
    color: Colors.textSecondary,
    fontSize: 16,
    lineHeight: 23,
  },

  // =========================
  // INFORMATION CARD
  // =========================
  card: {
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  cardError: {
    borderColor: ERROR_COLOR,
  },

  label: {
    marginTop: 15,
    color: Colors.textSecondary,
    fontSize: 14,
  },

  value: {
    fontSize: 18,
    fontFamily: "Roboto_600SemiBold",
    color: Colors.text,
    marginTop: 3,
  },

  valueError: {
    color: ERROR_COLOR,
  },

  // =========================
  // BUTTON
  // =========================
  button: {
    marginTop: 35,
    padding: 18,
    borderRadius: 14,
  },

  buttonText: {
    textAlign: "center",
    color: "#fff",
    fontWeight: "bold",
    fontSize: 18,
  },
});