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
import { S } from "@/constants/strings";

// Automatizacion de la respuesta segun contexto. Cualquier rol la ve; solo
// un admin la cambia, con step-up biometrico (el backend vuelve a validar el
// rol y audita cada cambio).
const MODES: { mode: AutomationMode; label: string; help: string }[] = (["off", "simulate", "active"] as const).map(
  (mode) => ({ mode, ...S.automation.modes[mode] })
);
const CRITICALITIES: Criticality[] = ["low", "medium", "high", "critical"];
const NUMERIC: { key: keyof PolicyConditions; label: string }[] = [
  { key: "minSeverity", label: S.automation.conditions.minSeverity },
  { key: "minAbuseScore", label: S.automation.conditions.minAbuseScore },
  { key: "minVtMalicious", label: S.automation.conditions.minVtMalicious },
  { key: "minHashPositives", label: S.automation.conditions.minHashPositives },
];

function describe(conditions: PolicyConditions): string[] {
  const lines = NUMERIC.filter(({ key }) => conditions[key] !== undefined).map(
    ({ key, label }) => `${label} ${conditions[key]}`
  );
  if (conditions.fromCountries) lines.push(S.automation.conditions.country(conditions.fromCountries));
  if (conditions.maxAssetCriticality) {
    lines.push(S.automation.conditions.assetCriticality(S.criticality[conditions.maxAssetCriticality]));
  }
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
  // Cortacircuitos (texto editable; se valida al guardar).
  const [maxActions, setMaxActions] = useState("");
  const [windowMinutes, setWindowMinutes] = useState("");

  const load = useCallback(() => {
    return Promise.all([getAutomation(), getStoredUser()])
      .then(([cfg, me]) => {
        setConfig(cfg);
        setAllowlist(cfg.settings.allowlist.join(", "));
        setMaxActions(String(cfg.settings.maxActions));
        setWindowMinutes(String(cfg.settings.windowMinutes));
        setIsAdmin(me.role === "admin");
        setError("");
      })
      .catch(() => setError(S.automation.loadError));
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
      Alert.alert(S.automation.notSaved, detail ?? S.common.genericError);
      return false;
    }
  };

  const changeMode = (mode: AutomationMode) => {
    const apply = () => run(S.automation.confirmMode(S.automation.modes[mode].label), () => updateAutomationSettings({ mode }));
    if (mode !== "active") return apply();
    Alert.alert(
      S.automation.enableTitle,
      S.automation.enableBody,
      [
        { text: S.common.cancel, style: "cancel" },
        { text: S.automation.enable, style: "destructive", onPress: apply },
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
        Alert.alert(S.automation.invalidValue, S.automation.invalidThresholds);
        return;
      }
      (conditions as Record<string, number>)[key] = n;
    }
    if (draftCriticality) conditions.maxAssetCriticality = draftCriticality;
    const saved = await run(S.automation.confirmPolicy(policy.name), () => updatePolicy(policy.id, { conditions }));
    if (saved) setEditing(null);
  };

  const saveBreaker = () => {
    const max = Number(maxActions);
    const minutes = Number(windowMinutes);
    if (!Number.isInteger(max) || max < 1 || !Number.isInteger(minutes) || minutes < 1) {
      Alert.alert(S.automation.invalidValue, S.automation.invalidBreaker);
      return;
    }
    run(S.automation.confirmBreaker, () => updateAutomationSettings({ maxActions: max, windowMinutes: minutes }));
  };

  const saveAllowlist = () => {
    const entries = allowlist.split(",").map((e) => e.trim()).filter(Boolean);
    run(S.automation.confirmAllowlist, () => updateAutomationSettings({ allowlist: entries }));
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
          <Text style={styles.backText}>{S.common.back}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{S.automation.title}</Text>
        <Text style={styles.subtitle}>{S.automation.subtitle}</Text>
        {!isAdmin ? <Text style={styles.readOnly}>{S.automation.readOnly}</Text> : null}

        {/* MODO */}
        <Text style={styles.section}>{S.automation.mode}</Text>
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
          <Text style={styles.help}>{S.automation.neverContained}</Text>
          {settings.updatedBy === "automation" && settings.mode === "simulate" ? (
            <Text style={styles.paused}>{S.automation.paused}</Text>
          ) : null}
          {settings.updatedBy ? (
            <Text style={styles.meta}>{S.automation.lastChange(settings.updatedBy, settings.updatedAt)}</Text>
          ) : null}
        </View>

        {/* LIMITES DE SEGURIDAD */}
        <Text style={styles.section}>{S.automation.safetyLimits}</Text>
        <View style={styles.card}>
          <Text style={styles.policyName}>{S.automation.breaker}</Text>
          <Text style={styles.help}>{S.automation.breakerHelp}</Text>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>{S.automation.maxActions}</Text>
            <TextInput style={styles.input} keyboardType="numeric" editable={isAdmin} value={maxActions} onChangeText={setMaxActions} />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>{S.automation.windowMinutes}</Text>
            <TextInput style={styles.input} keyboardType="numeric" editable={isAdmin} value={windowMinutes} onChangeText={setWindowMinutes} />
          </View>
          {isAdmin ? (
            <TouchableOpacity style={[styles.button, styles.primary, styles.saveAllowlist]} onPress={saveBreaker}>
              <Text style={styles.buttonText}>{S.automation.saveLimits}</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={[styles.policyName, styles.spaced]}>{S.automation.unknownAssets}</Text>
          <Text style={styles.help}>{S.automation.unknownAssetsHelp}</Text>
          <View style={styles.chips}>
            {CRITICALITIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, settings.defaultCriticality === c && styles.chipActive]}
                disabled={!isAdmin || settings.defaultCriticality === c}
                onPress={() => run(S.automation.confirmDefaultCriticality(S.criticality[c]), () => updateAutomationSettings({ defaultCriticality: c }))}
              >
                <Text style={[styles.chipText, settings.defaultCriticality === c && styles.chipTextActive]}>{S.criticality[c]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* POLITICAS */}
        <Text style={styles.section}>{S.automation.policies}</Text>
        {policies.map((policy) => (
          <View key={policy.id} style={[styles.card, !policy.enabled && styles.cardDisabled]}>
            <View style={styles.policyHeader}>
              <View style={styles.flex}>
                <Text style={styles.policyName}>{policy.name}</Text>
                <Text style={styles.meta}>
                  {policy.useCase} · {policy.action === "block-ip" ? S.automation.blockIp : S.automation.isolateHost}
                </Text>
              </View>
              <Switch
                value={policy.enabled}
                disabled={!isAdmin}
                trackColor={{ true: Colors.primary, false: Colors.border }}
                onValueChange={(enabled) => {
                  run(S.automation.confirmPolicyToggle(enabled, policy.name), () => updatePolicy(policy.id, { enabled }));
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
                    <Text style={styles.inputLabel}>{S.automation.conditions.maxAssetCriticality}</Text>
                    <View style={styles.chips}>
                      {CRITICALITIES.filter((c) => c !== "critical").map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={[styles.chip, draftCriticality === c && styles.chipActive]}
                          onPress={() => setDraftCriticality(c)}
                        >
                          <Text style={[styles.chipText, draftCriticality === c && styles.chipTextActive]}>{S.criticality[c]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => setEditing(null)}>
                    <Text style={styles.secondaryText}>{S.common.cancel}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, styles.primary]} onPress={() => savePolicy(policy)}>
                    <Text style={styles.buttonText}>{S.common.save}</Text>
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
                <PolicyPrecision policy={policy} />
                {isAdmin ? (
                  <TouchableOpacity style={styles.link} onPress={() => startEditing(policy)}>
                    <Text style={styles.linkText}>{S.automation.editThresholds}</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        ))}

        {/* ACTIVOS */}
        <Text style={styles.section}>{S.automation.assets}</Text>
        <View style={styles.card}>
          <Text style={styles.help}>{S.automation.assetsHelp(S.criticality[settings.defaultCriticality])}</Text>
          {assets.map((asset) => (
            <View key={asset.agentId} style={styles.asset}>
              <Text style={styles.policyName}>
                {asset.name} <Text style={styles.meta}>{S.automation.agent(asset.agentId)}</Text>
              </Text>
              <View style={styles.chips}>
                {CRITICALITIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, asset.criticality === c && styles.chipActive]}
                    disabled={!isAdmin || asset.criticality === c}
                    onPress={() => run(S.automation.confirmAsset(asset.name, S.criticality[c]), () => updateAsset(asset.agentId, c))}
                  >
                    <Text style={[styles.chipText, asset.criticality === c && styles.chipTextActive]}>{S.criticality[c]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* EXCLUSIONES */}
        <Text style={styles.section}>{S.automation.allowlist}</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={allowlist}
            editable={isAdmin}
            onChangeText={setAllowlist}
            placeholder={S.automation.allowlistPlaceholder}
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
          />
          {isAdmin ? (
            <TouchableOpacity style={[styles.button, styles.primary, styles.saveAllowlist]} onPress={saveAllowlist}>
              <Text style={styles.buttonText}>{S.automation.saveAllowlist}</Text>
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
  paused: { color: Colors.warning, marginTop: 10, fontWeight: "600" },
  spaced: { marginTop: 18 },
  precision: { marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8 },
  precisionLine: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  precisionValue: { color: Colors.text, fontWeight: "700" },
});

// Precision de la politica medida con los veredictos de los analistas: de
// los casos que contuvo (o habria contenido), cuantos eran ataques reales.
function PolicyPrecision({ policy }: { policy: AutomationPolicy }) {
  const line = (label: string, c: AutomationPolicy["stats"]["executed"]) =>
    c.total ? (
      <Text style={styles.precisionLine}>
        {label}: {c.total} · {S.automation.precision.closed(c.closed)}
        {c.precision !== null ? (
          <>
            {" "}· {S.automation.precision.precision} <Text style={styles.precisionValue}>{Math.round(c.precision * 100)}%</Text>
            {" "}{S.automation.precision.counts(c.true_positive, c.benign_positive, c.false_positive)}
          </>
        ) : null}
      </Text>
    ) : null;

  const { executed, simulated } = policy.stats;
  if (!executed.total && !simulated.total) {
    return <Text style={[styles.precisionLine, styles.precision]}>{S.automation.precision.none}</Text>;
  }
  return (
    <View style={styles.precision}>
      {line(S.automation.precision.contained, executed)}
      {line(S.automation.precision.simulated, simulated)}
    </View>
  );
}
