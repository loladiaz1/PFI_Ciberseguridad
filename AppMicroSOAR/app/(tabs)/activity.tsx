import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { Header } from '@/components/Header';
import { activitySeed } from '@/data/activity';
import Colors from "@/styles/colors";

export default function ActivityScreen() {
  return (
    <View style={styles.container}>
      <BrandLogo showText={false} />
      <Header title="Activity" subtitle="Recent system events" />
      <ScrollView contentContainerStyle={styles.content}>
        {activitySeed.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.time}>{item.timestamp}</Text>
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
  },

  content: {
    padding: 20,
    gap: 12,
  },

  card: {
    backgroundColor: Colors.card,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  title: {
    fontWeight: "600",
    color: Colors.text,
  },

  time: {
    color: Colors.textSecondary,
  },
});
