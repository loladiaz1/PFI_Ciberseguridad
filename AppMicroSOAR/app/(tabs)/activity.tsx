import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { Header } from "@/components/Header";
import { getAuditEvents } from "@/services/api";
import { AUDIT_CATEGORIES, AUDIT_ICONS } from "@/constants/audit";
import Colors from "@/styles/colors";
import type { ActivityItem, AuditCategory } from "@/types";


export default function ActivityScreen() {
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<AuditCategory | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getAuditEvents({ category })
        .then((data) => {
          if (cancelled) return;
          setEvents(data);
          setError("");
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
    }, [category])
  );

  return (
    <View style={styles.container}>
      <BrandHeader />
      <Header title="Activity" subtitle="Recent system events" />

      {/* Filtro por categoria (las calcula el backend, src/audit.js) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filtersContent}>
        {AUDIT_CATEGORIES.map(({ key, label }) => (
          <TouchableOpacity
            key={label}
            style={[styles.chip, category === key && styles.chipActive]}
            onPress={() => setCategory(key)}
          >
            <Text style={[styles.chipText, category === key && styles.chipTextActive]} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {loading && <ActivityIndicator size="large" style={styles.spinner} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && events.length === 0 && (
          <Text style={styles.empty}>No recent activity yet.</Text>
        )}

        {events.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.card}
            disabled={!item.incidentId}
            onPress={() => router.push({ pathname: "/incident", params: { id: String(item.incidentId) } })}
          >
            <MaterialCommunityIcons
              name={AUDIT_ICONS[item.type] ?? "bell-outline"}
              size={20}
              color={Colors.primary}
              style={styles.icon}
            />
            <View style={styles.textBlock}>
              <Text style={styles.title}>{item.detail}</Text>
              <Text style={styles.time}>
                {new Date(item.createdAt).toLocaleString()}
                {item.actor ? ` · ${item.actor}` : ""}
                {item.incidentId ? ` · incident #${item.incidentId}` : ""}
              </Text>
            </View>
            {item.incidentId ? (
              <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.textSecondary} />
            ) : null}
          </TouchableOpacity>
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

  // Un ScrollView horizontal dentro de una columna se encoge y aplasta los
  // chips: alto fijo y sin compresion.
  filters: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 48,
    marginBottom: 4,
  },

  filtersContent: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    alignItems: "center",
    gap: 8,
  },

  chip: {
    flexShrink: 0,
    minHeight: 34,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },

  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },

  chipText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },

  chipTextActive: {
    color: Colors.text,
    fontWeight: "700",
  },
});
