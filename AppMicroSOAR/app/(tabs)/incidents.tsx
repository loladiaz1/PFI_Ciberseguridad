import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from "react-native";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/styles/colors";
import { BrandHeader } from "@/components/ui/BrandHeader";
import { getClosureCatalog, getIncidents } from "@/services/api";
import { severityLabel } from "@/utils/severity";
import { VERDICTS } from "@/constants/verdicts";
import type { Incident, IncidentFilters } from "@/types";
import { REFRESH_MS } from "@/constants/refresh";
import { S } from "@/constants/strings";

// Opciones de cada filtro (los aplica el backend: GET /api/v1/incidents).
type Option<K extends keyof IncidentFilters> = { label: string; value: IncidentFilters[K] };
const STATUS: Option<"status">[] = [
    { label: S.incidents.status.open, value: "open" },
    { label: S.incidents.status.closed, value: "closed" },
    { label: S.incidents.status.all, value: undefined },
];
const CONTAINED: Option<"contained">[] = [
    { label: S.incidents.any, value: undefined },
    { label: S.incidents.contained.yes, value: "yes" },
    { label: S.incidents.contained.no, value: "no" },
    { label: S.incidents.contained.auto, value: "auto" },
];
const USE_CASE: Option<"useCase">[] = [
    { label: S.incidents.any, value: undefined },
    { label: S.incidents.useCase.bruteForce, value: "CU-01" },
    { label: S.incidents.useCase.malware, value: "CU-02" },
    { label: S.incidents.useCase.phishing, value: "CU-03" },
];
const SEVERITY: Option<"minSeverity">[] = [
    { label: S.incidents.any, value: undefined },
    { label: S.incidents.minSeverity.medium, value: 4 },
    { label: S.incidents.minSeverity.high, value: 7 },
    { label: S.incidents.minSeverity.critical, value: 12 },
];
const VERDICT: Option<"verdict">[] = [
    { label: S.incidents.any, value: undefined },
    { label: VERDICTS.true_positive.label, value: "true_positive" },
    { label: VERDICTS.benign_positive.label, value: "benign_positive" },
    { label: VERDICTS.false_positive.label, value: "false_positive" },
];
const SORT: Option<"sort">[] = [
    { label: S.incidents.sort.recent, value: "recent" },
    { label: S.incidents.sort.severity, value: "severity" },
];

export default function IncidentsList() {
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    // Por defecto, lo que el analista tiene que atender: los casos abiertos.
    const [filters, setFilters] = useState<IncidentFilters>({ status: "open", sort: "recent" });
    const [search, setSearch] = useState("");
    const [showFilters, setShowFilters] = useState(false);
    const [tagLabels, setTagLabels] = useState<Record<string, string>>({});

    useEffect(() => {
        getClosureCatalog().then((c) => setTagLabels(c.tags)).catch(() => setTagLabels({}));
    }, []);

    // La busqueda se aplica 400 ms despues de dejar de escribir.
    useEffect(() => {
        const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search.trim() || undefined })), 400);
        return () => clearTimeout(timer);
    }, [search]);

    const set = <K extends keyof IncidentFilters>(key: K, value: IncidentFilters[K]) =>
        setFilters((f) => ({ ...f, [key]: value }));

    // Filtros del panel activos (no cuenta estado, orden ni busqueda).
    const activeCount = useMemo(
        () => (["contained", "useCase", "minSeverity", "verdict", "tag"] as const).filter((k) => filters[k] !== undefined).length,
        [filters]
    );

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            const load = () =>
                getIncidents(filters)
                    .then(({ data }) => {
                        if (cancelled) return;
                        setIncidents(data);
                        setError("");
                    })
                    .catch(() => {
                        if (!cancelled) setError(S.incidents.loadError);
                    })
                    .finally(() => {
                        if (!cancelled) setLoading(false);
                    });

            // Spinner solo en la primera carga; los refrescos son silenciosos.
            load();
            const timer = setInterval(load, REFRESH_MS);
            return () => {
                cancelled = true;
                clearInterval(timer);
            };
        }, [filters])
    );

    const chips = <K extends keyof IncidentFilters>(key: K, options: Option<K>[]) => (
        <View style={styles.chips}>
            {options.map((o) => (
                <TouchableOpacity
                    key={o.label}
                    style={[styles.chip, filters[key] === o.value && styles.chipActive]}
                    onPress={() => set(key, o.value)}
                >
                    <Text style={[styles.chipText, filters[key] === o.value && styles.chipTextActive]} numberOfLines={1}>
                        {o.label}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );

    return (
        <View style={styles.container}>
            <ScrollView keyboardShouldPersistTaps="handled">
                <BrandHeader />

                <Text style={styles.title}>{S.incidents.title}</Text>

                {/* Busqueda: #numero, host o IP */}
                <View style={styles.searchRow}>
                    <MaterialCommunityIcons name="magnify" size={20} color={Colors.textSecondary} />
                    <TextInput
                        style={styles.search}
                        value={search}
                        onChangeText={setSearch}
                        placeholder={S.incidents.search}
                        placeholderTextColor={Colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {search ? (
                        <TouchableOpacity onPress={() => setSearch("")}>
                            <MaterialCommunityIcons name="close-circle" size={18} color={Colors.textSecondary} />
                        </TouchableOpacity>
                    ) : null}
                </View>

                <View style={styles.toolbar}>
                    {chips("status", STATUS)}
                    <TouchableOpacity style={styles.filtersButton} onPress={() => setShowFilters((v) => !v)}>
                        <MaterialCommunityIcons name="tune-variant" size={18} color={Colors.primary} />
                        <Text style={styles.filtersButtonText}>{S.incidents.filters(activeCount)}</Text>
                    </TouchableOpacity>
                </View>

                {showFilters ? (
                    <View style={styles.panel}>
                        <Text style={styles.panelLabel}>{S.incidents.panel.contained}</Text>
                        {chips("contained", CONTAINED)}
                        <Text style={styles.panelLabel}>{S.incidents.panel.useCase}</Text>
                        {chips("useCase", USE_CASE)}
                        <Text style={styles.panelLabel}>{S.incidents.panel.severity}</Text>
                        {chips("minSeverity", SEVERITY)}
                        <Text style={styles.panelLabel}>{S.incidents.panel.verdict}</Text>
                        {chips("verdict", VERDICT)}
                        <Text style={styles.panelLabel}>{S.incidents.panel.tag}</Text>
                        {chips("tag", [{ label: S.incidents.any, value: undefined }, ...Object.entries(tagLabels).map(([value, label]) => ({ label: S.tags[value] ?? label, value }))])}
                        <Text style={styles.panelLabel}>{S.incidents.panel.sort}</Text>
                        {chips("sort", SORT)}
                        {activeCount ? (
                            <TouchableOpacity
                                style={styles.clear}
                                onPress={() => setFilters((f) => ({ status: f.status, sort: f.sort, q: f.q }))}
                            >
                                <Text style={styles.clearText}>{S.incidents.clear}</Text>
                            </TouchableOpacity>
                        ) : null}
                    </View>
                ) : null}

                {loading && <ActivityIndicator size="large" style={styles.spinner} />}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {!loading && !error && incidents.length === 0 && (
                    <Text style={styles.empty}>{S.incidents.empty}</Text>
                )}

                {incidents.map((incident) => {
                    const severity = severityLabel(incident.severity);
                    return (
                        <TouchableOpacity
                            key={incident.id}
                            style={styles.incident}
                            onPress={() => router.push({ pathname: "/incident", params: { id: String(incident.id) } })}
                        >
                            <View style={styles.info}>
                                <Text style={styles.incidentId}>#{incident.id}</Text>
                                <Text style={styles.incidentTitle}>{incident.hostname}</Text>
                                {/* CU-02 (malware en el host) no tiene IP atacante */}
                                <Text style={styles.server} numberOfLines={1}>
                                    {incident.srcIp ?? incident.ruleDescription}
                                </Text>
                            </View>

                            <View style={styles.badges}>
                                <Text style={[styles.badge, { backgroundColor: severity.color }]}>
                                    {severity.label}
                                </Text>
                                {incident.closedAt && incident.verdict ? (
                                    <Text style={[styles.verdict, { color: VERDICTS[incident.verdict].color }]}>
                                        {VERDICTS[incident.verdict].label}
                                    </Text>
                                ) : null}
                                <Text style={styles.status}>
                                    {incident.alertCount > 1 ? S.incidents.alerts(incident.alertCount) : ""}
                                    {incident.closedAt ? S.closed : S.incidentStatus[incident.status]}
                                </Text>
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

    searchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 20,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: Colors.border,
        borderRadius: 12,
        backgroundColor: Colors.card,
    },

    search: {
        flex: 1,
        color: Colors.text,
        paddingVertical: 10,
    },

    toolbar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginHorizontal: 20,
        marginTop: 12,
        gap: 8,
    },

    chips: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        flexShrink: 1,
    },

    chip: {
        flexShrink: 0,
        minHeight: 32,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: Colors.border,
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 5,
    },

    chipActive: {
        backgroundColor: Colors.primary,
        borderColor: Colors.primary,
    },

    chipText: {
        color: Colors.textSecondary,
        fontSize: 13,
    },

    chipTextActive: {
        color: Colors.text,
        fontWeight: "700",
    },

    filtersButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 6,
    },

    filtersButtonText: {
        color: Colors.primary,
        fontWeight: "700",
    },

    panel: {
        backgroundColor: Colors.card,
        marginHorizontal: 20,
        marginTop: 10,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Colors.border,
    },

    panelLabel: {
        color: Colors.textSecondary,
        fontSize: 12,
        marginTop: 10,
        marginBottom: 6,
        textTransform: "uppercase",
    },

    clear: {
        marginTop: 14,
        alignSelf: "flex-start",
    },

    clearText: {
        color: Colors.primary,
        fontWeight: "700",
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
        marginTop: 16,
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

    info: {
        flex: 1,
        marginRight: 12,
    },

    incidentId: {
        color: Colors.primary,
        fontWeight: "700",
        fontSize: 13,
        marginBottom: 2,
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

    verdict: {
        marginTop: 6,
        fontWeight: "700",
        fontSize: 12,
    },

    status: {
        color: Colors.textSecondary,
        marginTop: 6,
        textTransform: "capitalize",
    },
});
