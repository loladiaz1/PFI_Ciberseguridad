import { StyleSheet, Text, View } from "react-native";

import Colors from "../styles/colors";
import { S } from "@/constants/strings";
import type { IncidentEmail } from "../types";

// CU-03: los correos de la campana de phishing, con sus indicadores y lo que
// dice VirusTotal de cada uno.
const domainOf = (address: string | null) => address?.split("@")[1] ?? null;

function vtStyle(n: number | null | undefined) {
  return n != null && n > 0 ? styles.danger : styles.sub;
}

export function EmailCard({ emails }: { emails: IncidentEmail[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{S.email.title(emails.length)}</Text>
      {emails.map((email) => {
        const replyToDiffers = email.replyTo && domainOf(email.replyTo) !== domainOf(email.fromAddress);
        return (
          <View key={email.id} style={styles.email}>
            <Text style={styles.label}>{S.email.subject}</Text>
            <Text selectable style={styles.value}>{email.subject ?? S.email.noSubject}</Text>

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
  email: { marginTop: 4 },
  label: { color: Colors.textSecondary, marginTop: 12 },
  value: { fontSize: 16, fontWeight: "600", color: Colors.text },
  sub: { color: Colors.textSecondary, fontSize: 13 },
  mono: { color: Colors.text, fontSize: 12, fontFamily: "monospace" },
  danger: { color: Colors.danger, fontSize: 13 },
  item: { marginTop: 6 },
});
