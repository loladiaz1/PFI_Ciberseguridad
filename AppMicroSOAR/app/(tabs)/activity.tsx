import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import BottomNav from '../../components/BottomNav';
import { BrandHeader } from '../../components/ui/BrandHeader';
import { Header } from '../../components/Header';
import { activitySeed } from '../../data/activity';
import { getAuditEvents } from '../../services/api';
import Colors from '../../styles/colors';
import type { ActivityItem } from '../../types';

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  login: "login",
  incident_detected: "shield-alert",
  ip_blocked: "shield-lock",
};

// Heurística simple para darle un ícono y color distinto a cada tipo de evento
// según palabras clave en el título. Si más adelante activitySeed trae un campo
// `type` propio, se puede reemplazar esta función por un mapeo directo.
function getActivityVisual(title: string): {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
} {
  const lower = title.toLowerCase();

  if (lower.includes('sync')) {
    return { icon: 'sync', color: Colors.primary };
  }

  if (lower.includes('queue') || lower.includes('triage')) {
    return { icon: 'format-list-bulleted', color: Colors.warning };
  }

  if (lower.includes('playbook')) {
    return { icon: 'book-open-variant', color: Colors.success };
  }

  if (lower.includes('block')) {
    return { icon: 'shield-lock', color: Colors.danger };
  }

  return {
    icon: 'bell-outline',
    color: Colors.textSecondary,
  };
}


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

        {events.length > 0 ? (
          events.map((item) => (
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
          ))
        ) : (
          activitySeed.map((item, index) => {
            const v = getActivityVisual(item.title);
            return (
              <View key={index} style={[styles.card, styles.cardSpacing]}>
                <View style={[styles.iconBadge, { backgroundColor: v.color }]}> 
                  <MaterialCommunityIcons name={v.icon} size={20} color="#fff" />
                </View>

                <View style={styles.textBlock}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.time}>{item.time}</Text>
                </View>
              </View>
            );
          })
        )}

          </View>
        ) : (
          activitySeed.map((item, index) => {
            const visual = getActivityVisual(item.title);
            const isLast = index === activitySeed.length - 1;

            return (
              <View
                key={item.id}
                style={[
                  styles.card,
                  !isLast && styles.cardSpacing,
                ]}
              >
                <View
                  style={[
                    styles.iconBadge,
                    {
                      backgroundColor: `${visual.color}22`,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={visual.icon}
                    size={20}
                    color={visual.color}
                  />
                </View>

                <View style={styles.textBlock}>
                  <Text style={styles.title}>
                    {item.title}
                  </Text>
                </View>

                <Text style={styles.time}>
                  {item.timestamp}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>

      <BottomNav />
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
    paddingBottom: 110,
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

  cardSpacing: {
    marginBottom: 12,
  },

  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  icon: {
    marginRight: 12,
  },
    marginRight: 12,
  },

  textBlock: {
    flex: 1,
  },

  title: {
    fontWeight: '600',
    color: Colors.text,
    fontSize: 15,
  },

  time: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginLeft: 10,
    marginTop: 2,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },

  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
});