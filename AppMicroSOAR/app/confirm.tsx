import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { getIncidentById } from "../services/api";
import { severityLabel } from "../utils/severity";
import type { Incident, MitigationAction } from "../types";
import { S } from "@/constants/strings";

export default function ConfirmScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action: MitigationAction }>();
  const isIsolate = action === "isolate-host";
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

  return (
    <View style={styles.container}>
      <BrandHeader />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        <Text style={styles.icon}>⚠️</Text>

        <Text style={styles.title}>
          {S.confirm.title}
        </Text>

        <Text style={styles.subtitle}>
          {isIsolate ? S.confirm.subtitleIsolate : S.confirm.subtitleBlock}
        </Text>

        <View style={styles.card}>

          {incident.srcIp ? (
            <>
              <Text style={styles.label}>{S.fields.attackerIp}</Text>
              <Text style={styles.value}>{incident.srcIp}</Text>
            </>
          ) : null}

          <Text style={styles.label}>{S.fields.target}</Text>
          <Text style={styles.value}>{incident.hostname}</Text>

          <Text style={styles.label}>{S.fields.severity}</Text>
          <Text style={[styles.critical, { color: severity.color }]}>{severity.label}</Text>

        </View>

        <Text style={styles.warning}>
          {isIsolate
            ? S.confirm.warningIsolate
            : S.confirm.warningBlock}
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push({
            pathname: "/loading",
            params: { id: String(incident.id), action, srcIp: incident.srcIp ?? "", hostname: incident.hostname },
          })}
        >
          <Text style={styles.buttonText}>
            {isIsolate ? S.actions.isolateHost : S.actions.blockIp}
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
