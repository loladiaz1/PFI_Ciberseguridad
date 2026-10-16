import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isAxiosError } from "axios";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { closeIncident, getClosureCatalog, getIncidentById } from "@/services/api";
import { confirmWithBiometrics } from "@/services/stepUp";
import { VERDICTS, tagsOf } from "@/constants/verdicts";
import Colors from "@/styles/colors";
import type { ClosureCatalog, Incident, Verdict } from "@/types";
import { S } from "@/constants/strings";

// Cerrar un caso: veredicto (obligatorio), etiquetas del catalogo y nota
// (obligatoria para benigno y falso positivo). "Falso positivo" pide step-up:
// descartar una alerta que era un ataque es el error mas caro en un SOC.
export default function CloseIncidentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [catalog, setCatalog] = useState<ClosureCatalog | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getIncidentById(Number(id)), getClosureCatalog()])
      .then(([{ data }, cat]) => {
        setIncident(data ?? null);
        setCatalog(cat);
      })
      .catch(() => Alert.alert(S.common.error, S.close.loadError));
  }, [id]);

  if (!incident || !catalog) {
    return (
      <View style={styles.container}>
        <BrandHeader />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  // Las etiquetas que ya tiene (las pone el sistema: caso de uso, accion) no
  // se pueden quitar desde aca; solo se suman.
  const existing = tagsOf(incident);
  const noteRequired = verdict !== null && catalog.noteRequired.includes(verdict);
  const noteOk = !noteRequired || note.trim().length >= catalog.minNoteLength;
  const canSubmit = verdict !== null && noteOk && !saving;

  const toggleTag = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));

  const submit = async () => {
    if (!verdict) return;
    if (verdict === "false_positive" && !(await confirmWithBiometrics(S.close.confirmFalsePositive))) return;

    setSaving(true);
    try {
      await closeIncident(incident.id, { verdict, tags, note: note.trim() || undefined });
      router.back();
    } catch (err) {
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
      Alert.alert(S.close.error, detail ?? S.common.genericError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <BrandHeader />

      {/* Con edge-to-edge Android no achica la ventana al abrir el teclado:
          KeyboardAvoidingView deja lugar y la nota se lleva a la vista. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textSecondary} />
          <Text style={styles.backText}>{S.common.back}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{S.close.title(incident.id)}</Text>
        <Text style={styles.subtitle}>{incident.hostname}{incident.srcIp ? ` · ${incident.srcIp}` : ""}</Text>

        <Text style={styles.section}>{S.close.verdict}</Text>
        {catalog.verdicts.map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.verdict, verdict === v && { borderColor: VERDICTS[v].color, backgroundColor: Colors.card2 }]}
            onPress={() => setVerdict(v)}
          >
            <MaterialCommunityIcons
              name={verdict === v ? "radiobox-marked" : "radiobox-blank"}
              size={22}
              color={verdict === v ? VERDICTS[v].color : Colors.textSecondary}
            />
            <View style={styles.flex}>
              <Text style={[styles.verdictLabel, { color: VERDICTS[v].color }]}>{VERDICTS[v].label}</Text>
              <Text style={styles.help}>{VERDICTS[v].help}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.section}>{S.close.tags}</Text>
        <View style={styles.chips}>
          {Object.entries(catalog.tags).map(([key, label]) => {
            const locked = existing.includes(key);
            const selected = locked || tags.includes(key);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.chip, selected && styles.chipActive, locked && styles.chipLocked]}
                disabled={locked}
                onPress={() => toggleTag(key)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>{S.tags[key] ?? label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {existing.length ? <Text style={styles.help}>{S.close.lockedTags}</Text> : null}

        <Text style={styles.section}>{S.close.note(noteRequired, catalog.minNoteLength)}</Text>
        <TextInput
          style={styles.note}
          multiline
          value={note}
          onChangeText={setNote}
          placeholder={S.close.notePlaceholder}
          placeholderTextColor={Colors.textSecondary}
          onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd(), 300)}
        />

        <TouchableOpacity style={[styles.button, !canSubmit && styles.buttonDisabled]} disabled={!canSubmit} onPress={submit}>
          <Text style={styles.buttonText}>{saving ? S.close.submitting : S.close.submit}</Text>
        </TouchableOpacity>
        {verdict === "false_positive" ? (
          <Text style={styles.help}>{S.close.falsePositiveHelp}</Text>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
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
  section: { color: Colors.primary, fontWeight: "700", fontSize: 16, marginTop: 22, marginBottom: 8 },
  verdict: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  verdictLabel: { fontWeight: "700", fontSize: 16 },
  help: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLocked: { opacity: 0.6 },
  chipText: { color: Colors.textSecondary },
  chipTextActive: { color: Colors.text, fontWeight: "700" },
  note: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    color: Colors.text,
    padding: 12,
    minHeight: 100,
    textAlignVertical: "top",
  },
  button: { marginTop: 24, backgroundColor: Colors.primary, padding: 16, borderRadius: 14, alignItems: "center" },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: Colors.text, fontWeight: "bold", fontSize: 17 },
});
