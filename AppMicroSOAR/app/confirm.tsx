import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { getIncidentById } from "../services/api";
import { severityLabel } from "../utils/severity";
import type { Incident } from "../types";

export default function ConfirmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
          Confirm Action
        </Text>

        <Text style={styles.subtitle}>
          You are about to block the following IP
        </Text>

        <View style={styles.card}>

          <Text style={styles.label}>Attacker IP</Text>
          <Text style={styles.value}>{incident.srcIp}</Text>

          <Text style={styles.label}>Target</Text>
          <Text style={styles.value}>{incident.hostname}</Text>

          <Text style={styles.label}>Severity</Text>
          <Text style={[styles.critical, { color: severity.color }]}>{severity.label}</Text>

        </View>

        <Text style={styles.warning}>
          This action will update the firewall rules and block the attacker.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push({
            pathname: "/loading",
            params: { id: String(incident.id), srcIp: incident.srcIp, hostname: incident.hostname },
          })}
        >
          <Text style={styles.buttonText}>
            BLOCK IP
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.back()}
        >
          <Text style={styles.cancel}>
            Cancel
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
