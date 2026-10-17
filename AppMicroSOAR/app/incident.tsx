import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, Alert, KeyboardAvoidingView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { isAxiosError } from "axios";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { EmailCard } from "../components/EmailCard";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { getIncidentById, getIncidentTimeline, reopenIncident } from "../services/api";
import { VERDICTS, tagsOf } from "../constants/verdicts";
import { AUDIT_ICONS } from "../constants/audit";
import { getStoredUser } from "../services/auth";
import { incidentRules, severityLabel } from "../utils/severity";
import type { Incident, MitigationAction, TimelineEntry } from "../types";
import { S, formatDate } from "../constants/strings";

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

    // Linea de tiempo del caso: cada alerta agrupada + eventos vinculados
    // (automatizacion, acciones). Si falla, el detalle se muestra igual.
    const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
    // Apartados desplegables: la evidencia (alertas) abierta, el registro de
    // auditoria del caso cerrado para no alargar el detalle.
    const [showAlerts, setShowAlerts] = useState(true);
    const [showAudit, setShowAudit] = useState(false);
    // Motivo de la automatizacion: 3 lineas; tocando se ve completo.
    const [showReason, setShowReason] = useState(false);

    // Reapertura del caso.
    const [reopening, setReopening] = useState(false);
    const [reopenNote, setReopenNote] = useState("");
    // Al escribir la nota de reapertura, el teclado no debe taparla: se
    // lleva la tarjeta del cierre arriba de la pantalla.
    const scrollRef = useRef<ScrollView>(null);
    const closedCardY = useRef(0);

    // Se recarga cada vez que la pantalla vuelve a quedar en foco: por
    // ejemplo, al volver de cerrar el caso o de ejecutar una accion.
    const load = useCallback(() => {
        if (!id) return;
        getIncidentById(Number(id))
            .then(({ data }) => setIncident(data ?? null))
            .catch(() => setError(S.incident.loadError))
            .finally(() => setLoading(false));
        getIncidentTimeline(Number(id))
            .then(setTimeline)
            .catch(() => setTimeline([]));
    }, [id]);

    useFocusEffect(load);

    const confirmReopen = async () => {
        if (!incident) return;
        try {
            await reopenIncident(incident.id, reopenNote.trim());
            setReopening(false);
            setReopenNote("");
            load();
        } catch (err) {
            const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
            Alert.alert(S.incident.reopenError, detail ?? S.common.genericError);
        }
    };

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
                    <Text selectable style={styles.value}>{error || S.incident.notFound}</Text>
                </View>
                <BottomNav />
            </View>
        );
    }

    const severity = severityLabel(incident.severity);
    const isEmail = incident.useCase === "CU-03";
    const action: MitigationAction = isEmail ? "quarantine-email" : incident.srcIp ? "block-ip" : "isolate-host";
    const actionLabel = S.flow[action].label;
    const vt: VtStats | null = incident.enrichmentVt ? JSON.parse(incident.enrichmentVt) : null;
    const abuse: AbuseStats | null = incident.enrichmentAbuseIpdb ? JSON.parse(incident.enrichmentAbuseIpdb) : null;
    const mitigatedAt = incident.status === "blocked" ? incident.blockedAt
        : incident.status === "isolated" ? incident.isolatedAt
        : incident.status === "quarantined" ? incident.quarantinedAt
        : null;

    return (
        <View style={styles.container}>
            <BrandHeader />

            <KeyboardAvoidingView style={styles.scroll} behavior="padding">
            <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                {/* El caso se identifica por su numero (el mismo que usa la
                    auditoria, "incident #N"); un caso agrupado tiene varias reglas. */}
                <Text style={styles.title}>{S.incident.title(incident.id)}</Text>
                {isEmail ? null : <Text selectable style={styles.rules}>{S.incident.rules(incidentRules(incident))}</Text>}

                {incident.ruleDescription ? (
                    <Text selectable style={styles.subtitle}>{incident.ruleDescription}</Text>
                ) : null}

                <View style={styles.card}>

                    <Text style={styles.label}>{S.incident.detected}</Text>
                    <Text selectable style={styles.value}>{formatDate(incident.timestamp)}</Text>

                    {incident.alertCount > 1 ? (
                        <>
                            <Text style={styles.label}>{S.incident.groupedAlerts}</Text>
                            <Text selectable style={styles.value}>{S.incident.groupedValue(incident.alertCount)}</Text>
                        </>
                    ) : null}

                    <Text style={styles.label}>{S.fields.severity}</Text>
                    <View style={styles.statusRow}>
                        <MaterialIcons name="error" size={22} color={severity.color} />
                        <Text style={[styles.critical, { color: severity.color }]}>{severity.label}</Text>
                    </View>

                    <Text style={styles.label}>{S.fields.target}</Text>
                    <Text selectable style={styles.value}>{incident.hostname}</Text>

                    {incident.srcIp ? (
                        <>
                            <Text style={styles.label}>{S.fields.attackerIp}</Text>
                            <Text selectable style={styles.value}>{incident.srcIp}</Text>
                        </>
                    ) : null}

                    <Text style={styles.label}>{S.fields.agent}</Text>
                    <Text selectable style={styles.value}>{incident.agentId}</Text>

                    <Text style={styles.label}>{S.fields.status}</Text>
                    <Text selectable style={styles.value}>{incident.closedAt ? S.closed : S.incidentStatus[incident.status]}</Text>

                </View>

                {incident.srcIp ? (
                    <View style={styles.intel}>
                        <Text style={styles.intelTitle}>{S.incident.intel}</Text>

                        {!vt && !abuse ? (
                            <Text selectable style={styles.recText}>{S.incident.noIntel}</Text>
                        ) : null}

                        {vt ? (
                            <>
                                <Text style={styles.label}>VirusTotal</Text>
                                <Text selectable style={[styles.value, vt.malicious > 0 && { color: Colors.danger }]}>
                                    {S.incident.vt(vt.malicious, vt.suspicious, vt.harmless)}
                                </Text>
                            </>
                        ) : null}

                        {abuse ? (
                            <>
                                <Text style={styles.label}>AbuseIPDB</Text>
                                <Text selectable style={[styles.value, abuse.abuseConfidenceScore >= 50 && { color: Colors.danger }]}>
                                    {S.incident.abuse(abuse.abuseConfidenceScore, abuse.totalReports)}
                                    {abuse.countryCode ? ` · ${abuse.countryCode}` : ""}
                                </Text>
                            </>
                        ) : null}
                    </View>
                ) : null}

                {incident.emails?.length ? <EmailCard emails={incident.emails} /> : null}

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
                                {incident.automationDecision === "executed" ? S.incident.autoContained
                                    : incident.automationDecision === "failed" ? S.incident.autoFailed
                                    : S.incident.simulation(action === "block-ip")}
                            </Text>
                        </View>
                        {incident.automationPolicy ? (
                            <Text selectable style={styles.recText}>{S.incident.policy(incident.automationPolicy)}</Text>
                        ) : null}
                        {incident.automationDecision === "failed" || incident.automationReason?.includes("cortacircuitos") ? (
                            <Text selectable style={styles.automationReason}>{incident.automationReason}</Text>
                        ) : null}
                    </View>
                ) : incident.automationReason ? (
                    <TouchableOpacity onPress={() => setShowReason((v) => !v)}>
                        {/* Expandido, una politica por linea (vienen separadas por " | ") */}
                        <Text selectable style={styles.automationReason} numberOfLines={showReason ? undefined : 3}>
                            {S.incident.automation(
                                showReason ? incident.automationReason.split(" | ").join("\n") : incident.automationReason
                            )}
                        </Text>
                        <Text style={styles.reasonToggle}>{showReason ? S.incident.showLess : S.incident.showMore}</Text>
                    </TouchableOpacity>
                ) : null}

                {/* Etiquetas del caso (las del sistema y las del analista) */}
                {tagsOf(incident).length ? (
                    <View style={styles.tags}>
                        {tagsOf(incident).map((t) => (
                            <View key={t} style={styles.tag}>
                                <Text style={styles.tagText}>{S.tags[t] ?? t}</Text>
                            </View>
                        ))}
                    </View>
                ) : null}

                {incident.closedAt && incident.verdict ? (
                    <View
                        style={[styles.closed, { borderColor: VERDICTS[incident.verdict].color }]}
                        onLayout={(e) => (closedCardY.current = e.nativeEvent.layout.y)}
                    >
                        <Text style={styles.recTitle}>{S.incident.closedTitle}</Text>
                        <Text style={[styles.verdict, { color: VERDICTS[incident.verdict].color }]}>
                            {VERDICTS[incident.verdict].label}
                        </Text>
                        <Text selectable style={styles.recText}>{S.incident.closedBy(incident.closedBy, incident.closedAt)}</Text>
                        {incident.closingNote ? <Text selectable style={styles.closingNote}>{`"${incident.closingNote}"`}</Text> : null}

                        {canAct && !reopening ? (
                            <TouchableOpacity style={styles.secondaryButton} onPress={() => setReopening(true)}>
                                <Text style={styles.secondaryButtonText}>{S.incident.reopen}</Text>
                            </TouchableOpacity>
                        ) : null}
                        {reopening ? (
                            <>
                                <TextInput
                                    style={styles.noteInput}
                                    multiline
                                    value={reopenNote}
                                    onChangeText={setReopenNote}
                                    placeholder={S.incident.reopenPlaceholder}
                                    placeholderTextColor={Colors.textSecondary}
                                    onFocus={() => setTimeout(() => scrollRef.current?.scrollTo({ y: closedCardY.current }), 300)}
                                />
                                <View style={styles.rowButtons}>
                                    <TouchableOpacity style={[styles.secondaryButton, styles.flex1]} onPress={() => setReopening(false)}>
                                        <Text style={styles.secondaryButtonText}>{S.common.cancel}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.secondaryButton, styles.flex1, reopenNote.trim().length < 10 && styles.disabled]}
                                        disabled={reopenNote.trim().length < 10}
                                        onPress={confirmReopen}
                                    >
                                        <Text style={styles.secondaryButtonText}>{S.incident.reopenConfirm}</Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        ) : null}
                    </View>
                ) : null}

                {incident.closedAt ? null : mitigatedAt ? (
                    <View style={styles.recommendation}>
                        <Text style={styles.recTitle}>{S.incident.alreadyMitigated}</Text>
                        <Text selectable style={styles.recText}>{S.incident.mitigatedAt(incident.status, mitigatedAt)}</Text>
                        {/* La cuarentena es reversible (falso positivo / correo legitimo). */}
                        {isEmail && canAct ? (
                            <TouchableOpacity
                                style={styles.secondaryButton}
                                onPress={() => router.push({ pathname: "/auth", params: { id: String(incident.id), action: "restore-email" } })}
                            >
                                <Text style={styles.secondaryButtonText}>{S.flow["restore-email"].label}</Text>
                            </TouchableOpacity>
                        ) : null}
                    </View>
                ) : (
                    <>
                        <View style={styles.recommendation}>
                            <Text style={styles.recTitle}>{S.incident.recommendationTitle}</Text>
                            <Text selectable style={styles.recText}>
                                {action === "quarantine-email"
                                    ? S.incident.recommendationQuarantine(severity.label.toLowerCase(), incident.alertCount)
                                    : action === "block-ip"
                                    ? S.incident.recommendationBlock(severity.label.toLowerCase(), incident.hostname)
                                    : S.incident.recommendationIsolate(severity.label.toLowerCase(), incident.hostname)}
                            </Text>
                            <Text selectable style={styles.recText}>{S.incident.recommendedAction}</Text>
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
                            <Text style={styles.readOnly}>{S.incident.readOnly}</Text>
                        )}
                    </>
                )}

                {!incident.closedAt && canAct ? (
                    <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => router.push({ pathname: "/close", params: { id: String(incident.id) } })}
                    >
                        <Text style={styles.secondaryButtonText}>{S.incident.closeCase}</Text>
                    </TouchableOpacity>
                ) : null}

                {/* Evidencia del caso: cada alerta, incluidas las agrupadas */}
                {timeline.some((e) => e.kind === "alert") ? (
                    <View style={styles.timeline}>
                        <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowAlerts((v) => !v)}>
                            <Text style={styles.timelineTitle}>
                                {S.incident.alerts(timeline.filter((e) => e.kind === "alert").length)}
                            </Text>
                            <MaterialCommunityIcons name={showAlerts ? "chevron-up" : "chevron-down"} size={24} color={Colors.textSecondary} />
                        </TouchableOpacity>
                        {showAlerts
                            ? timeline.map((entry, i) =>
                                  entry.kind === "alert" ? (
                                      <View key={`alert-${i}`} style={styles.timelineRow}>
                                          <MaterialCommunityIcons name="alert-circle" size={18} color={severityLabel(entry.severity).color} />
                                          <View style={styles.timelineText}>
                                              <Text selectable style={styles.timelineMain}>
                                                  {entry.ruleId === "user-report"
                                                      ? S.email.reportAlert(entry.grouped)
                                                      : S.incident.alertRule(entry.ruleId, entry.grouped)}
                                              </Text>
                                              {entry.detail ? <Text selectable style={styles.timelineSub}>{entry.detail}</Text> : null}
                                              {entry.hashPositives != null ? (
                                                  <Text selectable style={styles.timelineSub}>{S.incident.vtEngines(entry.hashPositives)}</Text>
                                              ) : null}
                                              <Text style={styles.timelineTime}>{formatDate(entry.at)}</Text>
                                          </View>
                                      </View>
                                  ) : null
                              )
                            : null}
                    </View>
                ) : null}

                {/* Registro de auditoria del caso: deteccion, agrupamiento, automatizacion, acciones */}
                {timeline.some((e) => e.kind === "event") ? (
                    <View style={styles.timeline}>
                        <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowAudit((v) => !v)}>
                            <Text style={styles.timelineTitle}>
                                {S.incident.auditLog(timeline.filter((e) => e.kind === "event").length)}
                            </Text>
                            <MaterialCommunityIcons name={showAudit ? "chevron-up" : "chevron-down"} size={24} color={Colors.textSecondary} />
                        </TouchableOpacity>
                        {showAudit
                            ? timeline.map((entry, i) =>
                                  entry.kind === "event" ? (
                                      <View key={`event-${i}`} style={styles.timelineRow}>
                                          <MaterialCommunityIcons name={AUDIT_ICONS[entry.type] ?? "bell-outline"} size={18} color={Colors.primary} />
                                          <View style={styles.timelineText}>
                                              <Text selectable style={styles.timelineMain}>{entry.detail}</Text>
                                              {entry.actor ? <Text selectable style={styles.timelineSub}>{S.common.by(entry.actor)}</Text> : null}
                                              <Text style={styles.timelineTime}>{formatDate(entry.at)}</Text>
                                          </View>
                                      </View>
                                  ) : null
                              )
                            : null}
                    </View>
                ) : null}

            </ScrollView>
            </KeyboardAvoidingView>

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

    rules: {
        fontSize: 16,
        fontWeight: "600",
        color: Colors.primary,
        marginBottom: 6,
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

    tags: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 14,
    },

    // Borde y relleno en un View: sobre un Text, Android los dibuja desparejos.
    tag: {
        backgroundColor: Colors.card2,
        borderWidth: 1,
        borderColor: Colors.border,
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },

    tagText: {
        color: Colors.text,
        fontSize: 12,
    },

    reasonToggle: {
        color: Colors.primary,
        fontSize: 12,
        marginTop: 4,
    },

    closed: {
        backgroundColor: Colors.card,
        padding: 16,
        borderRadius: 16,
        marginTop: 25,
        borderWidth: 1,
    },

    verdict: {
        fontWeight: "bold",
        fontSize: 20,
        marginBottom: 6,
    },

    closingNote: {
        color: Colors.text,
        fontStyle: "italic",
        marginTop: 6,
    },

    secondaryButton: {
        marginTop: 16,
        borderWidth: 1,
        borderColor: Colors.primary,
        padding: 14,
        borderRadius: 14,
        alignItems: "center",
    },

    secondaryButtonText: {
        color: Colors.primary,
        fontWeight: "bold",
        fontSize: 16,
    },

    noteInput: {
        borderWidth: 1,
        borderColor: Colors.border,
        borderRadius: 12,
        color: Colors.text,
        padding: 12,
        minHeight: 80,
        marginTop: 12,
        textAlignVertical: "top",
    },

    rowButtons: {
        flexDirection: "row",
        gap: 10,
    },

    flex1: {
        flex: 1,
    },

    disabled: {
        opacity: 0.4,
    },

    timeline: {
        backgroundColor: Colors.card,
        padding: 16,
        borderRadius: 16,
        marginTop: 16,
        borderWidth: 1,
        borderColor: Colors.border,
    },

    timelineTitle: {
        fontWeight: "bold",
        fontSize: 18,
        color: Colors.text,
    },

    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },

    timelineRow: {
        flexDirection: "row",
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: Colors.border,
    },

    timelineText: {
        flex: 1,
    },

    timelineMain: {
        color: Colors.text,
        fontWeight: "600",
    },

    timelineSub: {
        color: Colors.textSecondary,
        fontSize: 13,
        marginTop: 2,
    },

    timelineTime: {
        color: Colors.textSecondary,
        fontSize: 11,
        marginTop: 4,
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
