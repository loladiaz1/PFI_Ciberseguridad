import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isAxiosError } from "axios";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { getAutomation, updateAsset, updateAutomationSettings, updatePolicy } from "@/services/api";
import { getStoredUser } from "@/services/auth";
import { confirmWithBiometrics } from "@/services/stepUp";
import Colors from "@/styles/colors";
import type { AutomationConfig, AutomationMode, AutomationPolicy, Criticality, PolicyConditions } from "@/types";

// Automatizacion de la respuesta segun contexto. Cualquier rol la ve; solo
// un admin la cambia, con step-up biometrico (el backend vuelve a validar el
// rol y audita cada cambio).
const MODES: { mode: AutomationMode; label: string; help: string }[] = [
  { mode: "off", label: "Off", help: "Every incident waits for an analyst." },
  { mode: "simulate", label: "Simulation", help: "Policies are evaluated and logged, but nothing is executed." },
  { mode: "active", label: "Active", help: "Matching incidents are contained automatically." },
];
const CRITICALITIES: Criticality[] = ["low", "medium", "high", "critical"];
const NUMERIC: { key: keyof PolicyConditions; label: string }[] = [
  { key: "minSeverity", label: "Severity ≥" },
  { key: "minAbuseScore", label: "AbuseIPDB score ≥" },
  { key: "minVtMalicious", label: "VirusTotal detections (IP) ≥" },
  { key: "minHashPositives", label: "VirusTotal engines (file) ≥" },
];

function describe(conditions: PolicyConditions): string[] {
  const lines = NUMERIC.filter(({ key }) => conditions[key] !== undefined).map(
    ({ key, label }) => `${label} ${conditions[key]}`
  );
  if (conditions.fromCountries) lines.push(`Country in ${conditions.fromCountries.join(", ")}`);
  if (conditions.maxAssetCriticality) lines.push(`Asset criticality ≤ ${conditions.maxAssetCriticality}`);
  return lines;
}

export default function AutomationScreen() {
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftCriticality, setDraftCriticality] = useState<Criticality | undefined>();
  const [allowlist, setAllowlist] = useState("");

  const load = useCallback(() => {
    return Promise.all([getAutomation(), getStoredUser()])
      .then(([cfg, me]) => {
        setConfig(cfg);
        setAllowlist(cfg.settings.allowlist.join(", "));
        setIsAdmin(me.role === "admin");
        setError("");
      })
      .catch(() => setError("Could not load automation settings"));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Step-up -> cambio -> recarga. Muestra el rechazo del backend tal cual.
  const run = async (prompt: string, action: () => Promise<unknown>) => {
    if (!(await confirmWithBiometrics(prompt))) return false;
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
      Alert.alert("Change not saved", detail ?? "Something went wrong. Try again.");
      return false;
    }
  };

  const changeMode = (mode: AutomationMode) => {
    const apply = () => run(`Confirm automation mode: ${mode}`, () => updateAutomationSettings({ mode }));
    if (mode !== "active") return apply();
    Alert.alert(
      "Enable automatic response",
      "Matching incidents will be contained without waiting for an analyst. Critical assets and allowlisted IPs are always excluded.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Enable", style: "destructive", onPress: apply },
      ]
    );
  };

  const startEditing = (policy: AutomationPolicy) => {
    setEditing(policy.id);
    setDraft(
      Object.fromEntries(
        NUMERIC.filter(({ key }) => policy.conditions[key] !== undefined).map(({ key }) => [key, String(policy.conditions[key])])
      )
    );
    setDraftCriticality(policy.conditions.maxAssetCriticality);
  };

  const savePolicy = async (policy: AutomationPolicy) => {
    const conditions: PolicyConditions = { ...policy.conditions };
    for (const [key, value] of Object.entries(draft)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        Alert.alert("Invalid value", "Thresholds must be numbers ≥ 0.");
        return;
      }
      (conditions as Record<string, number>)[key] = n;
    }
    if (draftCriticality) conditions.maxAssetCriticality = draftCriticality;
    const saved = await run(`Confirm changes to "${policy.name}"`, () => updatePolicy(policy.id, { conditions }));
    if (saved) setEditing(null);
  };

  const saveAllowlist = () => {
    const entries = allowlist.split(",").map((e) => e.trim()).filter(Boolean);
    run("Confirm allowlist change", () => updateAutomationSettings({ allowlist: entries }));
  };

  if (!config) {
    return (
      <View style={styles.container}>
        <BrandHeader />
        <View style={styles.centered}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator size="large" color={Colors.primary} />}
        </View>
      </View>
    );
  }

  const { settings, policies, assets } = config;

  return (
    <View style={styles.container}>
      <BrandHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Automation</Text>
        <Text style={styles.subtitle}>Context-based automatic response</Text>
        {!isAdmin ? <Text style={styles.readOnly}>Read-only: only an administrator can change automation.</Text> : null}

        {/* MODO */}
        <Text style={styles.section}>Mode</Text>
        <View style={styles.card}>
          <View style={styles.chips}>
            {MODES.map(({ mode, label }) => (
              <TouchableOpacity
                key={mode}
                style={[styles.chip, settings.mode === mode && styles.chipActive]}
                disabled={!isAdmin || settings.mode === mode}
                onPress={() => changeMode(mode)}
              >
                <Text style={[styles.chipText, settings.mode === mode && styles.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.help}>{MODES.find((m) => m.mode === settings.mode)?.help}</Text>
          <Text style={styles.help}>Critical assets and allowlisted IPs are never contained automatically.</Text>
          {settings.updatedBy ? (
            <Text style={styles.meta}>
              Last change by {settings.updatedBy} · {new Date(settings.updatedAt).toLocaleString()}
            </Text>
          ) : null}
        </View>

        {/* POLITICAS */}
        <Text style={styles.section}>Policies (first match wins)</Text>
        {policies.map((policy) => (
          <View key={policy.id} style={[styles.card, !policy.enabled && styles.cardDisabled]}>
            <View style={styles.policyHeader}>
              <View style={styles.flex}>
                <Text style={styles.policyName}>{policy.name}</Text>
                <Text style={styles.meta}>
                  {policy.useCase} · {policy.action === "block-ip" ? "Block IP" : "Isolate host"}
                </Text>
              </View>
              <Switch
                value={policy.enabled}
                disabled={!isAdmin}
                trackColor={{ true: Colors.primary, false: Colors.border }}
                onValueChange={(enabled) => {
                  run(`Confirm to ${enabled ? "enable" : "disable"} "${policy.name}"`, () => updatePolicy(policy.id, { enabled }));
                }}
              />
            </View>

            {editing === policy.id ? (
              <>
                {Object.keys(draft).map((key) => (
                  <View key={key} style={styles.inputRow}>
                    <Text style={styles.inputLabel}>{NUMERIC.find((n) => n.key === key)?.label}</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={draft[key]}
                      onChangeText={(value) => setDraft((d) => ({ ...d, [key]: value }))}
                    />
                  </View>
                ))}
                {policy.conditions.maxAssetCriticality ? (
                  <>
                    <Text style={styles.inputLabel}>Asset criticality ≤</Text>
                    <View style={styles.chips}>
                      {CRITICALITIES.filter((c) => c !== "critical").map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={[styles.chip, draftCriticality === c && styles.chipActive]}
                          onPress={() => setDraftCriticality(c)}
                        >
                          <Text style={[styles.chipText, draftCriticality === c && styles.chipTextActive]}>{c}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => setEditing(null)}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, styles.primary]} onPress={() => savePolicy(policy)}>
                    <Text style={styles.buttonText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {describe(policy.conditions).map((line) => (
                  <Text key={line} style={styles.condition}>
                    • {line}
                  </Text>
                ))}
                {isAdmin ? (
                  <TouchableOpacity style={styles.link} onPress={() => startEditing(policy)}>
                    <Text style={styles.linkText}>Edit thresholds</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        ))}

        {/* ACTIVOS */}
        <Text style={styles.section}>Assets</Text>
        <View style={styles.card}>
          <Text style={styles.help}>
            Agents not listed use the default criticality ({settings.defaultCriticality}).
          </Text>
          {assets.map((asset) => (
            <View key={asset.agentId} style={styles.asset}>
              <Text style={styles.policyName}>
                {asset.name} <Text style={styles.meta}>· agent {asset.agentId}</Text>
              </Text>
              <View style={styles.chips}>
                {CRITICALITIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, asset.criticality === c && styles.chipActive]}
                    disabled={!isAdmin || asset.criticality === c}
                    onPress={() => run(`Confirm ${asset.name} as ${c}`, () => updateAsset(asset.agentId, c))}
                  >
                    <Text style={[styles.chipText, asset.criticality === c && styles.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* EXCLUSIONES */}
        <Text style={styles.section}>Allowlist (never blocked)</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={allowlist}
            editable={isAdmin}
            onChangeText={setAllowlist}
            placeholder="e.g. 10.0.0.0/8, 203.0.113.7"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
          />
          {isAdmin ? (
            <TouchableOpacity style={[styles.button, styles.primary, styles.saveAllowlist]} onPress={saveAllowlist}>
              <Text style={styles.buttonText}>Save allowlist</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingTop: 60 },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  flex: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backText: { color: Colors.textSecondary, fontWeight: "600" },
  title: { fontSize: 26, fontWeight: "bold", color: Colors.text },
  subtitle: { color: Colors.textSecondary, marginTop: 4 },
  readOnly: { color: Colors.warning, marginTop: 10 },
  error: { color: Colors.danger },
  section: { color: Colors.primary, fontWeight: "700", fontSize: 16, marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  cardDisabled: { opacity: 0.6 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, textTransform: "capitalize" },
  chipTextActive: { color: Colors.text, fontWeight: "700" },
  help: { color: Colors.textSecondary, marginTop: 10, lineHeight: 20 },
  meta: { color: Colors.textSecondary, fontSize: 12, marginTop: 4 },
  policyHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  policyName: { color: Colors.text, fontWeight: "700", fontSize: 15 },
  condition: { color: Colors.text, marginTop: 4 },
  link: { marginTop: 10 },
  linkText: { color: Colors.primary, fontWeight: "600" },
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 10 },
  inputLabel: { color: Colors.textSecondary, flex: 1, marginTop: 8 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, color: Colors.text, paddingHorizontal: 12, paddingVertical: 8, minWidth: 80 },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1 },
  primary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  buttonText: { color: Colors.text, fontWeight: "700" },
  secondary: { borderColor: Colors.border },
  secondaryText: { color: Colors.text, fontWeight: "600" },
  asset: { marginTop: 14 },
  saveAllowlist: { marginTop: 12, flex: 0 },
});
