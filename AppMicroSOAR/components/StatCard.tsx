import { StyleSheet, Text, View } from 'react-native';

type StatCardProps = {
  label: string;
  value: string;
  accent: string;
};

export function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <View style={[styles.card, { borderTopColor: accent }]}> 
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderTopWidth: 4 },
  value: { fontSize: 20, fontWeight: '700', color: '#111827' },
  label: { fontSize: 12, color: '#6b7280', marginTop: 4 },
});
