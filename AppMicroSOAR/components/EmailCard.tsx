import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import Colors from "../styles/colors";
import { S } from "@/constants/strings";
import type { IncidentEmail } from "../types";

// CU-03: los correos de la campana de phishing. Arriba los confirmados (los
// reporto un usuario), con sus indicadores y lo que dice VirusTotal; abajo
// los candidatos de la busqueda de similares, que el analista elige para la
// cuarentena o descarta.
const domainOf = (address: string | null) => address?.split("@")[1] ?? null;

function vtStyle(n: number | null | undefined) {
  return n != null && n > 0 ? styles.danger : styles.sub;
}

type Props = {
  emails: IncidentEmail[];
  canAct: boolean;
  selected: number[];
  onToggle: (id: number) => void;
  onDismiss: (email: IncidentEmail) => void;
  onSearch: () => void;
  searching: boolean;
};

export function EmailCard({ emails, canAct, selected, onToggle, onDismiss, onSearch, searching }: Props) {
  const confirmed = emails.filter((e) => e.origin !== "candidate");
  const candidates = emails.filter((e) => e.origin === "candidate");

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{S.email.title(confirmed.length)}</Text>
      {confirmed.map((email) => {
        const replyToDiffers = email.replyTo && domainOf(email.replyTo) !== domainOf(email.fromAddress);
        return (
          <View key={email.id} style={styles.email}>
            <Text style={styles.label}>{S.email.subject}</Text>
            <Text selectable style={styles.value}>{email.subject ?? S.email.noSubject}</Text>
            {/* Otra variante reportada que se sumo a la campana por sus indicadores. */}
            {email.matchedBy ? (
              <Text style={styles.reasons}>
                {S.email.matchedBy(email.matchedBy.reasons.map((r) => S.email.reason[r.type] ?? r.type))}
              </Text>
            ) : null}

            <Text style={styles.label}>{S.email.from}</Text>
            <Text selectable style={styles.value}>{email.fromAddress ?? "-"}</Text>

            {email.replyTo ? (
              <>
                <Text style={styles.label}>{S.email.replyTo}</Text>
                <Text selectable style={[styles.value, replyToDiffers && { color: Colors.danger }]}>{email.replyTo}</Text>
                {replyToDiffers ? <Text style={styles.danger}>{S.email.replyToDiffers}</Text> : null}
              </>
            ) : null}

            {email.reportedBy.length ? (
              <>
                <Text style={styles.label}>{S.email.reportedBy}</Text>
                <Text selectable style={styles.sub}>{email.reportedBy.join(", ")}</Text>
              </>
            ) : null}

            {email.urls.length ? (
              <>
                <Text style={styles.label}>{S.email.links}</Text>
                {email.urls.map((u) => (
                  <View key={u.url} style={styles.item}>
                    <Text selectable style={styles.mono}>{u.url}</Text>
                    <Text style={vtStyle(u.vtMalicious)}>{S.email.vt(u.vtMalicious)}</Text>
                  </View>
                ))}
              </>
            ) : null}

            {email.attachments.length ? (
              <>
                <Text style={styles.label}>{S.email.attachments}</Text>
                {email.attachments.map((a) => (
                  <View key={a.sha256} style={styles.item}>
                    <Text selectable style={styles.value}>{a.name ?? a.sha256.slice(0, 12)}</Text>
                    <Text selectable style={styles.mono}>SHA-256 {a.sha256}</Text>
                    <Text style={vtStyle(a.vtMalicious)}>{S.email.vt(a.vtMalicious)}</Text>
                  </View>
                ))}
              </>
            ) : null}

            <Text style={styles.label}>{S.fields.status}</Text>
            <Text style={styles.value}>{S.email.status[email.status]}</Text>
            {email.mailboxes.length ? <Text selectable style={styles.sub}>{S.email.mailboxes(email.mailboxes)}</Text> : null}
          </View>
        );
      })}

      <View style={styles.divider} />
      <View style={styles.headerRow}>
        <Text style={styles.subtitle}>{S.email.similarTitle(candidates.length)}</Text>
        {canAct ? (
          <TouchableOpacity onPress={onSearch} disabled={searching}>
            <Text style={styles.link}>{searching ? S.email.searching : S.email.search}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {candidates.length === 0 ? <Text style={styles.sub}>{S.email.noSimilar}</Text> : null}

      {candidates.map((email) => {
        const pending = email.status === "pending";
        const checked = selected.includes(email.id);
        return (
          <View key={email.id} style={[styles.candidate, email.status === "dismissed" && styles.dismissed]}>
            <View style={styles.headerRow}>
              {pending && canAct ? (
                <TouchableOpacity style={styles.check} onPress={() => onToggle(email.id)}>
                  <MaterialCommunityIcons
                    name={checked ? "checkbox-marked" : "checkbox-blank-outline"}
                    size={24}
                    color={checked ? Colors.primary : Colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
              <View style={styles.flex1}>
                <Text selectable style={styles.value}>{email.subject ?? S.email.noSubject}</Text>
                <Text selectable style={styles.sub}>{email.fromAddress ?? "-"}</Text>
              </View>
            </View>
            {email.matchedBy ? (
              <Text style={styles.reasons}>
                {S.email.matchedBy(email.matchedBy.reasons.map((r) => S.email.reason[r.type] ?? r.type))}
              </Text>
            ) : null}
            {email.mailboxes.length ? <Text selectable style={styles.sub}>{S.email.mailboxes(email.mailboxes)}</Text> : null}
            <View style={styles.headerRow}>
              <Text style={styles.sub}>{S.email.status[email.status]}</Text>
              {pending && canAct ? (
                <TouchableOpacity onPress={() => onDismiss(email)}>
                  <Text style={styles.link}>{S.email.dismiss}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 16,
    marginTop: 25,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { fontWeight: "bold", fontSize: 18, color: Colors.text },
  subtitle: { fontWeight: "bold", fontSize: 16, color: Colors.text, flex: 1 },
  email: { marginTop: 4 },
  label: { color: Colors.textSecondary, marginTop: 12 },
  value: { fontSize: 16, fontWeight: "600", color: Colors.text },
  sub: { color: Colors.textSecondary, fontSize: 13 },
  mono: { color: Colors.text, fontSize: 12, fontFamily: "monospace" },
  danger: { color: Colors.danger, fontSize: 13 },
  item: { marginTop: 6 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 18 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  link: { color: Colors.primary, fontWeight: "600" },
  candidate: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: Colors.card2, gap: 4 },
  dismissed: { opacity: 0.5 },
  check: { paddingRight: 4 },
  flex1: { flex: 1 },
  reasons: { color: Colors.warning, fontSize: 13 },
});
