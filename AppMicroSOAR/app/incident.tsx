import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { MaterialIcons } from "@expo/vector-icons";
import { getIncidentById } from "../services/api";
import { severityLabel } from "../utils/severity";
import type { Incident } from "../types";


export default function IncidentDetail() {
  const [fontsLoaded] = useFonts({
    Roboto_400Regular,
    Roboto_600SemiBold,
    Roboto_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={styles.container} />;
  }

    if (loading) {
        return (
            <View style={styles.container}>
                <BrandHeader />
                <View style={styles.centered}>
                    <ActivityIndicator size="large" />
                </View>
                <BottomNav />
            </View>
        );
    }

    if (error || !incident) {
        return (
            <View style={styles.container}>
                <BrandHeader />
                <View style={styles.centered}>
                    <Text style={styles.value}>{error || "Incident not found"}</Text>
                </View>
                <BottomNav />
            </View>
        );
    }


        <View style={styles.card}>
          <Text style={styles.label}>Severity</Text>
          <View style={styles.statusRow}>
            <MaterialIcons name="error" size={22} color={Colors.danger} />
            <Text style={styles.critical}>CRITICAL</Text>
          </View>

    return (
        <View style={styles.container}>
            <BrandHeader />

            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

                <Text style={styles.title}>Rule #{incident.ruleId}</Text>

                {incident.ruleDescription ? (
                    <Text style={styles.subtitle}>{incident.ruleDescription}</Text>
                ) : null}

                <View style={styles.card}>

                    <Text style={styles.label}>Detected</Text>
                    <Text style={styles.value}>{new Date(incident.timestamp).toLocaleString()}</Text>

                    <Text style={styles.label}>Severity</Text>
                    <View style={styles.statusRow}>
                        <MaterialIcons name="error" size={22} color={severity.color} />
                        <Text style={[styles.critical, { color: severity.color }]}>{severity.label}</Text>
                    </View>

                    <Text style={styles.label}>Target</Text>
                    <Text style={styles.value}>{incident.hostname}</Text>

                    <Text style={styles.label}>Attacker IP</Text>
                    <Text style={styles.value}>{incident.srcIp}</Text>

                    <Text style={styles.label}>Agent</Text>
                    <Text style={styles.value}>{incident.agentId}</Text>

                    <Text style={styles.label}>Status</Text>
                    <Text style={styles.value}>{incident.status}</Text>

                </View>

                {incident.status === "blocked" ? (
                    <View style={styles.recommendation}>
                        <Text style={styles.recTitle}>Already mitigated</Text>
                        <Text style={styles.recText}>This IP was blocked at {incident.blockedAt}.</Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.recommendation}>
                            <Text style={styles.recTitle}>Automatic Recommendation</Text>
                            <Text style={styles.recText}>This IP triggered a {severity.label.toLowerCase()} severity rule against {incident.hostname}.</Text>
                            <Text style={styles.recText}>Recommended action:</Text>
                            <Text style={styles.block}>BLOCK IP</Text>
                        </View>

                        <TouchableOpacity style={styles.button} onPress={() => router.push({ pathname: "/auth", params: { id: String(incident.id) } })}>
                            <Text style={styles.buttonText}>BLOCK IP</Text>
                        </TouchableOpacity>
                    </>
                )}

            </ScrollView>

            <BottomNav />


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

    container: {
        flex: 1,
        backgroundColor: Colors.background,
        paddingTop: 60
    },

    scroll: {
        flex: 1,
    },

    content: {
        padding: 20,
    },

    centered: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },

    title: {
        fontSize: 30,
        fontWeight: "bold",
        marginBottom: 6,
        color: Colors.text
    },

    subtitle: {
        fontSize: 15,
        color: Colors.textSecondary,
        marginBottom: 20
    },

    card: {
        backgroundColor: Colors.card,
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Colors.border
    },

    // kept existing brand styles
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