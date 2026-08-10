import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { router } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useFonts, Roboto_400Regular, Roboto_600SemiBold, Roboto_700Bold } from "@expo-google-fonts/roboto";

import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";

export default function IncidentDetail() {
  const [fontsLoaded] = useFonts({
    Roboto_400Regular,
    Roboto_600SemiBold,
    Roboto_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <BrandHeader />

        <Text style={styles.title}>SSH Brute Force</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Severity</Text>
          <View style={styles.statusRow}>
            <MaterialIcons name="error" size={22} color={Colors.danger} />
            <Text style={styles.critical}>CRITICAL</Text>
          </View>

          <Text style={styles.label}>Target</Text>
          <Text style={styles.value}>SERVER-02</Text>

          <Text style={styles.label}>Attacker IP</Text>
          <Text style={styles.value}>185.220.101.55</Text>

          <Text style={styles.label}>Country</Text>
          <Text style={styles.value}>Russia</Text>

          <Text style={styles.label}>Attempts</Text>
          <Text style={styles.value}>346</Text>
        </View>

        <View style={styles.recommendation}>
          <Text style={styles.recTitle}>Automatic Recommendation</Text>

          <Text style={styles.recText}>
            This IP has a malicious reputation and is attacking a critical asset.
          </Text>

          <Text style={styles.recText}>Recommended action:</Text>

          <Text style={styles.block}>BLOCK IP</Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={() => router.push("/confirm")}>
          <Text style={styles.buttonText}>BLOCK IP</Text>
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
    padding: 20,
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
    color: Colors.primary,
    marginLeft: 4,
  },

  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: Colors.text,
    marginBottom: 20,
  },

  card: {
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  label: {
    marginTop: 15,
    color: Colors.textSecondary,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },

  value: {
    fontSize: 18,
    fontFamily: "Roboto_600SemiBold",
    color: Colors.text,
  },

  critical: {
    fontFamily: "Roboto_700Bold",
    fontSize: 22,
    color: Colors.danger,
  },

  recommendation: {
    backgroundColor: Colors.card2,
    padding: 20,
    borderRadius: 16,
    marginTop: 25,
    borderWidth: 1,
    borderColor: Colors.warning,
  },

  recTitle: {
    fontWeight: "bold",
    fontSize: 18,
    marginBottom: 10,
    color: Colors.text,
  },

  recText: {
    marginBottom: 8,
    color: Colors.textSecondary,
  },

  block: {
    marginTop: 10,
    fontFamily: "Roboto_700Bold",
    color: Colors.danger,
    fontSize: 20,
  },

  button: {
    marginTop: 35,
    backgroundColor: Colors.danger,
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