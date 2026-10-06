import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import BottomNav from "../../components/BottomNav";
import { BrandHeader } from "../../components/ui/BrandHeader";
import Colors from "../../styles/colors";

import { getStoredUser, type User } from "../../services/auth";
import { updateUser } from "../../services/api";
import { clearToken } from "../../services/tokenStore";

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getStoredUser()
        .then((data) => {
          if (cancelled) return;
          setUser(data);
          setName(data?.name ?? "");
          setEmail(data?.email ?? "");
          setRole((data as any)?.role ?? "");
          setError("");
        })
        .catch(() => {
          if (!cancelled) setError("Could not load profile");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );
      return;
    }

    try {
      setSaving(true);

      const updatedUser = await updateUser(
        user.id,
        {
          name: name.trim(),
          email: email.trim(),
          role,
          avatarUrl: user.avatarUrl,
        }
      );

      setUser(updatedUser);

      setName(updatedUser.name);
      setEmail(updatedUser.email);
      setRole(updatedUser.role);

      setEditing(false);

      Alert.alert(
        "Profile updated",
        "Your profile has been updated successfully."
      );

    } catch (error) {

      console.error(
        "Profile update error:",
        error
      );

      Alert.alert(
        "Unable to update profile",
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );

    } finally {

      setSaving(false);

    }
  };

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
            />

{editing ? (

  <View style={styles.card}>

    <Text style={styles.sectionTitle}>Profile Information</Text>

    <Text style={styles.inputLabel}>Name</Text>
    <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={Colors.textSecondary} />

    <Text style={styles.inputLabel}>Email</Text>
    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={Colors.textSecondary} autoCapitalize="none" keyboardType="email-address" />

    <Text style={styles.inputLabel}>Role</Text>
    <View style={styles.roleSelector}>
      <TouchableOpacity style={[styles.roleOption, role === "OPERATOR" && styles.roleOptionSelected]} onPress={() => setRole("OPERATOR")}>
        <MaterialCommunityIcons name="account-hard-hat" size={18} color={role === "OPERATOR" ? Colors.primary : Colors.textSecondary} />
        <Text style={[styles.roleOptionText, role === "OPERATOR" && styles.roleOptionTextSelected]}>OPERATOR</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.roleOption, role === "ADMIN" && styles.roleOptionSelected]} onPress={() => setRole("ADMIN")}>
        <MaterialCommunityIcons name="shield-account" size={18} color={role === "ADMIN" ? Colors.primary : Colors.textSecondary} />
        <Text style={[styles.roleOptionText, role === "ADMIN" && styles.roleOptionTextSelected]}>ADMIN</Text>
      </TouchableOpacity>
    </View>

    <View style={styles.actionRow}>
      <TouchableOpacity style={styles.cancelButton} onPress={cancelEditing} disabled={saving}><Text style={styles.cancelButtonText}>Cancel</Text></TouchableOpacity>
      <TouchableOpacity style={styles.saveButton} onPress={saveProfile} disabled={saving}>{saving ? <ActivityIndicator size="small" color="#fff" /> : (<><MaterialCommunityIcons name="check" size={17} color="#fff" /><Text style={styles.saveButtonText}>Save Changes</Text></>)}</TouchableOpacity>
    </View>

  </View>

) : (

  <View style={styles.card}>

    <Text style={styles.sectionTitle}>Account Details</Text>

    <View style={styles.row}><Text style={styles.label}>Email</Text><Text style={styles.value} numberOfLines={1} ellipsizeMode="tail">{user.email}</Text></View>
    <View style={styles.divider} />

    <View style={styles.row}><Text style={styles.label}>Role</Text><Text style={styles.value}>{user.role}</Text></View>
    <View style={styles.divider} />

    <View style={styles.row}><Text style={styles.label}>User ID</Text><Text style={styles.value}>#{user.id}</Text></View>

    <TouchableOpacity style={styles.editButton} onPress={startEditing}><MaterialCommunityIcons name="pencil" size={16} color={Colors.primary} /><Text style={styles.editButtonText}>Edit Profile</Text></TouchableOpacity>

  </View>

)}

<TouchableOpacity style={styles.logoutButton} onPress={handleLogout}><MaterialCommunityIcons name="logout" size={18} color={Colors.danger} /><Text style={styles.logoutButtonText}>Log Out</Text></TouchableOpacity>
      </ScrollView>

      <BottomNav />

    </View>
  );
}


// ======================================
// ESTILOS
// ======================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 60,
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyState: {
    flex: 1,
    gap: 10,
  },

  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
  },

  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 12,
  },

  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
  },

  content: {
    padding: 20,
    paddingBottom: 110,
  },

  profileHeader: {
    alignItems: "center",
    marginBottom: 25,
  },

  avatarWrap: {
    position: "relative",
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
    alignItems: "center",
    justifyContent: "center",
  },

  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.background,
  },

  name: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
  },

  role: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },

  editingTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text,
  },

  editButton: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "600",
    fontSize: 13,
  },

  avatarWrap: {
    alignItems: "center",
    marginBottom: 20,
  },

  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  sectionTitle: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 16,
  },

  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },

  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: Colors.text,
    fontSize: 14,
    marginBottom: 14,
  },

  roleSelector: {
    gap: 8,
    marginBottom: 18,
  },

  roleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: Colors.background,
  },

  roleOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: "#2A2118",
  },

  roleOptionText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },

  roleOptionTextSelected: {
    color: Colors.primary,
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },

  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  cancelButtonText: {
    color: Colors.textSecondary,
    fontWeight: "600",
    fontSize: 13,
  },

  saveButton: {
    flex: 1.5,
    flexDirection: "row",
    gap: 7,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  saveButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
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
    fontWeight: "700",
    fontSize: 16,
    marginTop: 4,
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    color: Colors.text,
    backgroundColor: Colors.background,
  },

  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
    paddingVertical: 10,
  },

  editButtonText: {
    color: Colors.primary,
    fontWeight: "600",
  },

  editActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },

  cancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },

  cancelButtonText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },

  saveButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: "center",
  },

  saveButtonText: {
    color: "#fff",
    fontWeight: "700",
  },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.danger,
  },

  logoutButtonText: {
    color: Colors.danger,
    fontWeight: "700",
  },
});
