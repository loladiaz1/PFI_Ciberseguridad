import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { getIncidentById } from "../services/api";
import { confirmWithBiometrics } from "../services/stepUp";
import { severityLabel } from "../utils/severity";
import type { Incident, MitigationAction } from "../types";
import { S } from "@/constants/strings";

export default function ConfirmScreen() {
  // messageIds (CU-03): los correos elegidos, separados por coma.
  const { id, action, messageIds } = useLocalSearchParams<{ id: string; action: MitigationAction; messageIds?: string }>();
  const flow = S.flow[action];
  const [incident, setIncident] = useState<Incident | null>(null);

  useEffect(() => {
    if (!id) return;
    getIncidentById(Number(id)).then(({ data }) => setIncident(data ?? null));
  }, [id]);

  if (!incident) {
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

  const severity = severityLabel(incident.severity);
  const email = incident.emails?.[0];
  // Lo que se muestra como objetivo en la ejecucion y en el resultado.
  const count = messageIds ? messageIds.split(",").length : 1;
  const target = email
    ? count > 1 ? S.email.count(count) : (email.subject ?? S.email.noSubject)
    : action === "block-ip" ? (incident.srcIp ?? "") : incident.hostname;

  return (
    <View style={styles.container}>
      <BrandHeader />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        <Text style={styles.icon}>⚠️</Text>

        <Text style={styles.title}>
          {S.confirm.title}
        </Text>

        <Text style={styles.subtitle}>
          {flow.confirm}
        </Text>

        <View style={styles.card}>

          {email ? (
            <>
              <Text style={styles.label}>{S.email.subject}</Text>
              <Text style={styles.value}>{target}</Text>
              <Text style={styles.label}>{S.email.from}</Text>
              <Text style={styles.value}>{email.fromAddress ?? "-"}</Text>
            </>
          ) : (
            <>
              {incident.srcIp ? (
                <>
                  <Text style={styles.label}>{S.fields.attackerIp}</Text>
                  <Text style={styles.value}>{incident.srcIp}</Text>
                </>
              ) : null}

              <Text style={styles.label}>{S.fields.target}</Text>
              <Text style={styles.value}>{incident.hostname}</Text>
            </>
          )}

          <Text style={styles.label}>{S.fields.severity}</Text>
          <Text style={[styles.critical, { color: severity.color }]}>{severity.label}</Text>

        </View>

        <Text style={styles.warning}>
          {flow.warning}
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={async () => {
            // Step-up: la ventana biometrica del sistema dice que accion se
            // autoriza. Cancelar o fallar deja al analista en esta pantalla.
            if (!(await confirmWithBiometrics(flow.prompt))) return;
            // replace: al terminar, "volver" lleva al incidente, no a confirmar.
            router.replace({ pathname: "/loading", params: { id: String(incident.id), action, target, messageIds: messageIds ?? "" } });
          }}
        >
          <Text style={styles.buttonText}>
            {flow.label}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.back()}
        >
          <Text style={styles.cancel}>
            {S.common.cancel}
          </Text>
        </TouchableOpacity>

      </ScrollView>

      <BottomNav />

    </View>
  );
}

const styles = StyleSheet.create({

  container:{
    flex:1,
    backgroundColor:Colors.background,
    paddingTop:60,
  },

  scroll:{
    flex:1,
  },

  content:{
    flexGrow:1,
    justifyContent:"center",
    padding:25,
  },

  centered:{
    flex:1,
    justifyContent:"center",
    alignItems:"center",
  },

  icon:{
    fontSize:60,
    textAlign:"center",
    marginBottom:20
  },

  title:{
    color:Colors.text,
    fontSize:30,
    fontWeight:"bold",
    textAlign:"center"
  },

  subtitle:{
    color:Colors.textSecondary,
    textAlign:"center",
    marginTop:15,
    marginBottom:30
  },

  card:{
    backgroundColor:Colors.card,
    borderRadius:18,
    padding:20,
    borderWidth:1,
    borderColor:Colors.border
  },

  label:{
    color:Colors.textSecondary,
    marginTop:15,
    fontSize:13
  },

  value:{
    color:Colors.text,
    fontSize:19,
    fontWeight:"600",
    marginTop:5
  },

  critical:{
    fontSize:18,
    fontWeight:"bold",
    marginTop:5
  },

  warning:{
    color:Colors.textSecondary,
    textAlign:"center",
    marginTop:30,
    lineHeight:22
  },

  button:{
    marginTop:35,
    backgroundColor:Colors.primary,
    padding:18,
    borderRadius:15
  },

  buttonText:{
    color:"#fff",
    textAlign:"center",
    fontWeight:"bold",
    fontSize:17
  },

  cancel:{
    color:Colors.textSecondary,
    textAlign:"center",
    marginTop:18,
    fontSize:16
  }

});
