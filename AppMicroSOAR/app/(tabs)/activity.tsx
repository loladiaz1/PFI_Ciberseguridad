import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { Header } from "@/components/Header";
import { getAuditEvents } from "@/services/api";
import Colors from "@/styles/colors";
import type { ActivityItem } from "@/types";

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  login: "login",
  incident_detected: "shield-alert",
  ip_blocked: "shield-lock",
};

export default function ActivityScreen() {
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getAuditEvents()
        .then((data) => {
          if (!cancelled) setEvents(data);
        })
        .catch(() => {
          if (!cancelled) setError("Could not load activity");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View style={styles.container}>
      <BrandHeader />
      <Header title="Activity" subtitle="Recent system events" />

      <ScrollView contentContainerStyle={styles.content}>
        {loading && <ActivityIndicator size="large" style={styles.spinner} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && events.length === 0 && (
          <Text style={styles.empty}>No recent activity yet.</Text>
        )}

        {events.map((item) => (
          <View key={item.id} style={styles.card}>
            <MaterialCommunityIcons
              name={ICONS[item.type] ?? "bell-outline"}
              size={20}
              color={Colors.primary}
              style={styles.icon}
            />
            <View style={styles.textBlock}>
              <Text style={styles.title}>{item.detail}</Text>
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
          </View>
        ))}
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

  content: {
    padding: 20,
    gap: 12,
  },

  spinner: {
    marginTop: 30,
  },

  error: {
    color: Colors.danger,
  },

  empty: {
    color: Colors.textSecondary,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  icon: {
    marginRight: 12,
  },

  textBlock: {
    flex: 1,
  },

  title: {
    fontWeight: "600",
    color: Colors.text,
  },

  time: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
});
