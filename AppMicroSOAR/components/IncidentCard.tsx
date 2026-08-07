import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Incident } from '../types';

type IncidentCardProps = {
  incident: Incident;
  onPress?: () => void;
};

export function IncidentCard({ incident, onPress }: IncidentCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <Text style={styles.title}>{incident.title}</Text>
        <Text style={styles.badge}>{incident.status}</Text>
      </View>
      <Text style={styles.meta}>Severity: {incident.severity}</Text>
      <Text style={styles.meta}>Owner: {incident.owner}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', flex: 1, color: '#111827' },
  badge: { color: '#2563eb', fontWeight: '700', textTransform: 'capitalize' },
  meta: { color: '#6b7280', marginTop: 2 },
});
