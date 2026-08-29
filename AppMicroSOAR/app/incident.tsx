import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";
import { MaterialIcons } from "@expo/vector-icons";
import { getIncidentById } from "../services/api";
import { severityLabel } from "../utils/severity";
import type { Incident } from "../types";

export default function IncidentDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const [incident, setIncident] = useState<Incident | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!id) return;
        getIncidentById(Number(id))
            .then(({ data }) => setIncident(data ?? null))
            .catch(() => setError("Could not load incident"))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    if (error || !incident) {
        return (
            <View style={[styles.container, styles.centered]}>
                <Text style={styles.value}>{error || "Incident not found"}</Text>
            </View>
        );
    }

    const severity = severityLabel(incident.severity);

    return (
        <View style={styles.container}>
            <BrandLogo showText={false} />

            <Text style={styles.title}>
                Rule #{incident.ruleId}
            </Text>

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
                    <Text style={styles.recText}>
                        This IP was blocked at {incident.blockedAt}.
                    </Text>
                </View>
            ) : (
                <>
                    <View style={styles.recommendation}>
                        <Text style={styles.recTitle}>Automatic Recommendation</Text>
                        <Text style={styles.recText}>
                            This IP triggered a {severity.label.toLowerCase()} severity rule
                            against {incident.hostname}.
                        </Text>
                        <Text style={styles.recText}>Recommended action:</Text>
                        <Text style={styles.block}>BLOCK IP</Text>
                    </View>

                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => router.push({ pathname: "/auth", params: { id: String(incident.id) } })}
                    >
                        <Text style={styles.buttonText}>BLOCK IP</Text>
                    </TouchableOpacity>
                </>
            )}
            <BottomNav />

        </View>

    );

}

const styles = StyleSheet.create({

    container: {
        flex: 1,
        backgroundColor: Colors.background,
        padding: 20,
        paddingTop: 60
    },

    centered: {
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

    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 12
    },

    label: {
        color: Colors.textSecondary
    },

    value: {
        fontSize: 18,
        fontWeight: "600",
        color: Colors.text
    },

    critical: {
        marginLeft: 8,
        fontWeight: "bold",
        fontSize: 22
    },

    recommendation: {
        backgroundColor: Colors.card2,
        padding: 20,
        borderRadius: 16,
        marginTop: 25,
        borderWidth: 1,
        borderColor: Colors.warning
    },

    recTitle: {
        fontWeight: "bold",
        fontSize: 18,
        marginBottom: 10,
        color: Colors.warning
    },

    recText: {
        marginBottom: 8,
        color: Colors.text
    },

    block: {
        marginTop: 10,
        fontWeight: "bold",
        color: Colors.danger,
        fontSize: 20
    },

    button: {
        marginTop: 35,
        backgroundColor: Colors.danger,
        padding: 18,
        borderRadius: 14
    },

    buttonText: {
        textAlign: "center",
        color: Colors.text,
        fontWeight: "bold",
        fontSize: 18
    }
});
