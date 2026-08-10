import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import BottomNav from '../components/BottomNav';
import { BrandHeader } from '../components/ui/BrandHeader';
import { userSeed } from '../data/user';
import Colors from '../styles/colors';

export default function ProfileScreen() {
  // Si más adelante userSeed trae una foto real (ej: userSeed.avatarUrl),
  // se muestra acá automáticamente. Hasta entonces se ve el ícono placeholder.
  const avatarUrl = (userSeed as { avatarUrl?: string }).avatarUrl;

  return (
    <View style={styles.container}>
      <BrandHeader />

      <ScrollView contentContainerStyle={styles.content}>
        {/* AVATAR + NOMBRE + PUESTO */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <MaterialCommunityIcons name="account" size={56} color={Colors.textSecondary} />
              </View>
            )}

            <TouchableOpacity style={styles.avatarEditBadge}>
              <MaterialCommunityIcons name="camera" size={14} color="#fff" />
            </TouchableOpacity>
          </View>

          <Text style={styles.name}>{userSeed.name}</Text>
          <Text style={styles.role}>{userSeed.role}</Text>

          <TouchableOpacity style={styles.editButton}>
            <MaterialCommunityIcons name="pencil" size={16} color={Colors.primary} />
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* DETALLES DE LA CUENTA */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account Details</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{userSeed.email}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{userSeed.role}</Text>
          </View>
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
    paddingBottom: 110,
  },

  // =========================
  // AVATAR / NAME / ROLE
  // =========================
  profileHeader: {
    alignItems: 'center',
    marginBottom: 25,
  },

  avatarWrap: {
    position: 'relative',
    marginBottom: 14,
  },

  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },

  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
  },

  name: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },

  role: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },

  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
  },

  editButtonText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },

  // =========================
  // ACCOUNT DETAILS CARD
  // =========================
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  sectionTitle: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 12,
  },

  row: {
    paddingVertical: 4,
  },

  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },

  label: {
    color: Colors.textSecondary,
    fontSize: 13,
  },

  value: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: 16,
    marginTop: 4,
  },
});