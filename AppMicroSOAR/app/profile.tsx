import { ScrollView, StyleSheet, Text, View } from 'react-native';

import BottomNav from '../components/BottomNav';
import { BrandLogo } from '../components/BrandLogo';
import { Header } from '../components/Header';
import { userSeed } from '../data/user';
import Colors from "../styles/colors";

export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <BrandLogo showText={false} />
      <Header title="Profile" subtitle="Account details" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{userSeed.name}</Text>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{userSeed.email}</Text>
          <Text style={styles.label}>Role</Text>
          <Text style={styles.value}>{userSeed.role}</Text>
        </View>
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
  },

  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  label: {
    color: Colors.textSecondary,
    marginTop: 8,
  },

  value: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 16,
  },
});
