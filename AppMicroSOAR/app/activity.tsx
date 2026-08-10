import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import BottomNav from '../components/BottomNav';
import { BrandHeader } from '../components/ui/BrandHeader';
import { Header } from '../components/Header';
import { activitySeed } from '../data/activity';
import Colors from '../styles/colors';

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

  return { icon: 'bell-outline', color: Colors.textSecondary };
}

export default function ActivityScreen() {
  return (
    <View style={styles.container}>
      <BrandHeader />
      <Header title="Activity" subtitle="Recent system events" />

      <ScrollView contentContainerStyle={styles.content}>
        {activitySeed.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="history" size={48} color={Colors.textSecondary} />
            <Text style={styles.emptyText}>No recent activity yet</Text>
          </View>
        ) : (
          activitySeed.map((item, index) => {
            const visual = getActivityVisual(item.title);
            const isLast = index === activitySeed.length - 1;

            return (
              <View key={item.id} style={[styles.card, !isLast && styles.cardSpacing]}>
                <View style={[styles.iconBadge, { backgroundColor: `${visual.color}22` }]}>
                  <MaterialCommunityIcons name={visual.icon} size={20} color={visual.color} />
                </View>

                <View style={styles.textBlock}>
                  <Text style={styles.title}>{item.title}</Text>
                </View>

                <Text style={styles.time}>{item.timestamp}</Text>
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
  },

  content: {
    padding: 20,
    paddingBottom: 110,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
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