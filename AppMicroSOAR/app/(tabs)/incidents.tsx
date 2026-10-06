import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import Colors from "@/styles/colors";
import { BrandHeader } from "@/components/ui/BrandHeader";
import { getIncidents } from "@/services/api";
import { severityLabel } from "@/utils/severity";
import type { Incident } from "@/types";

export default function IncidentsList() {
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            setLoading(true);
            getIncidents()
                .then(({ data }) => {
                    if (!cancelled) setIncidents(data);
                })
                .catch(() => {
                    if (!cancelled) setError("Could not load incidents");
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
            return () => {
                cancelled = true;
            };
        }, [])
    );

    return (
        <View style={styles.container}>
            <ScrollView>
                <BrandHeader />

                <Text style={styles.title}>Incidents</Text>

                {loading && <ActivityIndicator size="large" style={styles.spinner} />}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {!loading && !error && incidents.length === 0 && (
                    <Text style={styles.empty}>No incidents yet.</Text>
                )}

                {incidents.map((incident) => {
                    const severity = severityLabel(incident.severity);
                    return (
                        <TouchableOpacity
                            key={incident.id}
                            style={styles.incident}
                            onPress={() => router.push({ pathname: "/incident", params: { id: String(incident.id) } })}
                        >
                            <View>
                                <Text style={styles.incidentTitle}>{incident.hostname}</Text>
                                <Text style={styles.server}>{incident.srcIp}</Text>
                            </View>

                            <View style={styles.badges}>
                                <Text style={[styles.badge, { backgroundColor: severity.color }]}>
                                    {severity.label}
                                </Text>
                                <Text style={styles.status}>{incident.status}</Text>
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
        paddingTop: 60,
    },

    title: {
        fontSize: 30,
        fontWeight: "bold",
        color: Colors.text,
        paddingHorizontal: 20,
        marginBottom: 10,
    },

    spinner: {
        marginTop: 30,
    },

    error: {
        color: Colors.danger,
        paddingHorizontal: 20,
        marginTop: 10,
    },

    empty: {
        color: Colors.textSecondary,
        paddingHorizontal: 20,
        marginTop: 10,
    },

    incident: {
        backgroundColor: Colors.card,
        marginHorizontal: 20,
        marginTop: 15,
        padding: 20,
        borderRadius: 18,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },

    incidentTitle: {
        fontSize: 18,
        fontWeight: "bold",
        color: Colors.text,
    },

    server: {
        color: Colors.textSecondary,
        marginTop: 6,
    },

    badges: {
        alignItems: "flex-end",
    },

    badge: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        color: "white",
        fontWeight: "bold",
        overflow: "hidden",
    },

    status: {
        color: Colors.textSecondary,
        marginTop: 6,
        textTransform: "capitalize",
    },
});
