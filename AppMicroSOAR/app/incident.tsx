import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { MaterialIcons } from "@expo/vector-icons";
import { getIncidentById } from "../services/api";
import { getStoredUser } from "../services/auth";
import { incidentRules, severityLabel } from "../utils/severity";
import type { Incident, MitigationAction } from "../types";

// Formas que guarda orchestrator/src/enrichment.js (JSON.stringify).
type VtStats = { malicious: number; suspicious: number; harmless: number };
type AbuseStats = { abuseConfidenceScore: number; totalReports: number; countryCode: string | null };

export default function IncidentDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const [incident, setIncident] = useState<Incident | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    // El backend rechaza la accion a un auditor (403); aca solo evitamos
    // ofrecerle un boton que no puede usar.
    const [canAct, setCanAct] = useState(false);

    useEffect(() => {
        getStoredUser()
            .then((u) => setCanAct(u.role === "admin" || u.role === "analyst"))
            .catch(() => setCanAct(false));
    }, []);

    useEffect(() => {
        if (!id) return;
        getIncidentById(Number(id))
            .then(({ data }) => setIncident(data ?? null))
            .catch(() => setError("Could not load incident"))
            .finally(() => setLoading(false));
    }, [id]);

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

    const severity = severityLabel(incident.severity);
    const action: MitigationAction = incident.srcIp ? "block-ip" : "isolate-host";
    const actionLabel = action === "block-ip" ? "BLOCK IP" : "ISOLATE HOST";
    const vt: VtStats | null = incident.enrichmentVt ? JSON.parse(incident.enrichmentVt) : null;
    const abuse: AbuseStats | null = incident.enrichmentAbuseIpdb ? JSON.parse(incident.enrichmentAbuseIpdb) : null;
    const mitigatedAt = incident.status === "blocked" ? incident.blockedAt
        : incident.status === "isolated" ? incident.isolatedAt
        : null;

    return (
        <View style={styles.container}>
            <BrandHeader />

            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

                <Text style={styles.title}>
                    {incidentRules(incident).length > 1 ? "Rules " : "Rule "}
                    {incidentRules(incident).map((r) => `#${r}`).join(", ")}
                </Text>

                {incident.ruleDescription ? (
                    <Text style={styles.subtitle}>{incident.ruleDescription}</Text>
                ) : null}

                <View style={styles.card}>

                    <Text style={styles.label}>Detected</Text>
                    <Text style={styles.value}>{new Date(incident.timestamp).toLocaleString()}</Text>

                    {incident.alertCount > 1 ? (
                        <>
                            <Text style={styles.label}>Grouped alerts</Text>
                            <Text style={styles.value}>
                                {incident.alertCount} alerts from the same attack
                            </Text>
                        </>
                    ) : null}

                    <Text style={styles.label}>Severity</Text>
                    <View style={styles.statusRow}>
                        <MaterialIcons name="error" size={22} color={severity.color} />
                        <Text style={[styles.critical, { color: severity.color }]}>{severity.label}</Text>
                    </View>

                    <Text style={styles.label}>Target</Text>
                    <Text style={styles.value}>{incident.hostname}</Text>

                    {incident.srcIp ? (
                        <>
                            <Text style={styles.label}>Attacker IP</Text>
                            <Text style={styles.value}>{incident.srcIp}</Text>
                        </>
                    ) : null}

                    <Text style={styles.label}>Agent</Text>
                    <Text style={styles.value}>{incident.agentId}</Text>

                    <Text style={styles.label}>Status</Text>
                    <Text style={styles.value}>{incident.status}</Text>

                </View>

                {incident.srcIp ? (
                    <View style={styles.intel}>
                        <Text style={styles.intelTitle}>Threat Intelligence</Text>

                        {!vt && !abuse ? (
                            <Text style={styles.recText}>No threat intelligence available for this IP yet.</Text>
                        ) : null}

                        {vt ? (
                            <>
                                <Text style={styles.label}>VirusTotal</Text>
                                <Text style={[styles.value, vt.malicious > 0 && { color: Colors.danger }]}>
                                    {vt.malicious} malicious · {vt.suspicious} suspicious · {vt.harmless} harmless
                                </Text>
                            </>
                        ) : null}

                        {abuse ? (
                            <>
                                <Text style={styles.label}>AbuseIPDB</Text>
                                <Text style={[styles.value, abuse.abuseConfidenceScore >= 50 && { color: Colors.danger }]}>
                                    {abuse.abuseConfidenceScore}% abuse confidence · {abuse.totalReports} reports
                                    {abuse.countryCode ? ` · ${abuse.countryCode}` : ""}
                                </Text>
                            </>
                        ) : null}
                    </View>
                ) : null}

                {/* Decision de la automatizacion (orchestrator/src/automation.js) */}
                {incident.automationDecision && incident.automationDecision !== "none" ? (
                    <View
                        style={[
                            styles.automation,
                            {
                                borderColor:
                                    incident.automationDecision === "executed" ? Colors.success
                                    : incident.automationDecision === "failed" ? Colors.danger
                                    : Colors.warning,
                            },
                        ]}
                    >
                        <View style={styles.statusRow}>
                            <MaterialIcons name="smart-toy" size={20} color={Colors.text} />
                            <Text style={styles.automationTitle}>
                                {incident.automationDecision === "executed" ? "Contained automatically"
                                    : incident.automationDecision === "failed" ? "Automatic response failed: action required"
                                    : `Simulation: would ${action === "block-ip" ? "block this IP" : "isolate this host"}`}
                            </Text>
                        </View>
                        {incident.automationPolicy ? (
                            <Text style={styles.recText}>Policy: {incident.automationPolicy}</Text>
                        ) : null}
                        {incident.automationDecision === "failed" ? (
                            <Text style={styles.automationReason}>{incident.automationReason}</Text>
                        ) : null}
                    </View>
                ) : incident.automationReason ? (
                    <Text style={styles.automationReason} numberOfLines={3}>
                        Automation: {incident.automationReason}
                    </Text>
                ) : null}

                {mitigatedAt ? (
                    <View style={styles.recommendation}>
                        <Text style={styles.recTitle}>Already mitigated</Text>
                        <Text style={styles.recText}>
                            {incident.status === "blocked" ? "This IP was blocked" : "This host was isolated"} at{" "}
                            {new Date(mitigatedAt).toLocaleString()}.
                        </Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.recommendation}>
                            <Text style={styles.recTitle}>Automatic Recommendation</Text>
                            <Text style={styles.recText}>
                                {action === "block-ip"
                                    ? `This IP triggered a ${severity.label.toLowerCase()} severity rule against ${incident.hostname}.`
                                    : `${incident.hostname} triggered a ${severity.label.toLowerCase()} severity rule. Isolating it cuts all its network traffic except the Wazuh manager channel.`}
                            </Text>
                            <Text style={styles.recText}>Recommended action:</Text>
                            <Text style={styles.block}>{actionLabel}</Text>
                        </View>

                        {canAct ? (
                            <TouchableOpacity
                                style={styles.button}
                                onPress={() => router.push({ pathname: "/auth", params: { id: String(incident.id), action } })}
                            >
                                <Text style={styles.buttonText}>{actionLabel}</Text>
                            </TouchableOpacity>
                        ) : (
                            <Text style={styles.readOnly}>Read-only access: an analyst must run this action.</Text>
                        )}
                    </>
                )}

            </ScrollView>

            <BottomNav />

        </View>

    );

}

const styles = StyleSheet.create({

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

    automation: {
        backgroundColor: Colors.card,
        padding: 16,
        borderRadius: 16,
        marginTop: 25,
        borderWidth: 1,
    },

    automationTitle: {
        marginLeft: 8,
        fontWeight: "bold",
        fontSize: 16,
        color: Colors.text,
        flex: 1,
    },

    automationReason: {
        color: Colors.textSecondary,
        fontSize: 12,
        marginTop: 12,
    },

    intel: {
        backgroundColor: Colors.card,
        padding: 20,
        borderRadius: 16,
        marginTop: 25,
        borderWidth: 1,
        borderColor: Colors.border
    },

    intelTitle: {
        fontWeight: "bold",
        fontSize: 18,
        marginBottom: 10,
        color: Colors.text
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

    readOnly: {
        marginTop: 30,
        color: Colors.textSecondary,
        textAlign: "center",
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
