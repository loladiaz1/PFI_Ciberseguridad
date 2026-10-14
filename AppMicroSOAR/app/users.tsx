import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isAxiosError } from "axios";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { getUsers, removeUser, updateUserAccess } from "@/services/api";
import { getStoredUser } from "@/services/auth";
import { confirmWithBiometrics } from "@/services/stepUp";
import Colors from "@/styles/colors";
import type { Role, UserProfile, UserStatus } from "@/types";

// Gestion de usuarios (solo admin): aprobar o rechazar registros, cambiar
// el rol y desactivar / reactivar / eliminar cuentas. Cada accion pide
// step-up biometrico; el backend vuelve a validar el rol y queda auditada.
const ROLES: Role[] = ["admin", "analyst", "auditor"];
const SECTIONS: { status: UserStatus; title: string }[] = [
  { status: "pending", title: "Pending approval" },
  { status: "active", title: "Active" },
  { status: "disabled", title: "Disabled" },
];

export default function UsersScreen() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [me, setMe] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return Promise.all([getUsers(), getStoredUser()])
      .then(([list, current]) => {
        setUsers(list);
        setMe(current.username);
        setError("");
      })
      .catch(() => setError("Could not load users"))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  // Step-up -> llamada -> recarga. Los rechazos del backend (por ejemplo,
  // quitar el ultimo admin) se muestran tal cual.
  const run = async (prompt: string, action: () => Promise<unknown>) => {
    if (!(await confirmWithBiometrics(prompt))) return;
    try {
      await action();
      await load();
    } catch (err) {
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
      Alert.alert("Action not allowed", detail ?? "Something went wrong. Try again.");
    }
  };

  const confirmRemove = (user: UserProfile, isRejection: boolean) => {
    Alert.alert(
      isRejection ? "Reject registration" : "Remove user",
      `${user.username} will be deleted. Their audit records are kept, anonymized.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isRejection ? "Reject" : "Remove",
          style: "destructive",
          onPress: () => run(`Confirm to remove ${user.username}`, () => removeUser(user.username)),
        },
      ]
    );
  };

  const renderUser = (user: UserProfile) => {
    const isMe = user.username === me;

    return (
      <View key={user.username} style={styles.card}>
        <Text style={styles.name}>
          {user.name}
          {isMe ? <Text style={styles.you}>  (you)</Text> : null}
        </Text>
        <Text style={styles.username}>{user.username}</Text>

        {user.status === "pending" ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.primary]}
              onPress={() =>
                run(`Confirm to approve ${user.username}`, () => updateUserAccess(user.username, { status: "active" }))
              }
            >
              <Text style={styles.buttonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.danger]} onPress={() => confirmRemove(user, true)}>
              <Text style={styles.dangerText}>Reject</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.label}>Role</Text>
            <View style={styles.roles}>
              {ROLES.map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[styles.chip, user.role === role && styles.chipActive]}
                  disabled={user.role === role}
                  onPress={() =>
                    run(`Confirm role change to ${role}`, () => updateUserAccess(user.username, { role }))
                  }
                >
                  <Text style={[styles.chipText, user.role === role && styles.chipTextActive]}>{role}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.secondary]}
                onPress={() => {
                  const status = user.status === "active" ? "disabled" : "active";
                  run(`Confirm to ${status === "active" ? "enable" : "disable"} ${user.username}`, () =>
                    updateUserAccess(user.username, { status })
                  );
                }}
              >
                <Text style={styles.secondaryText}>{user.status === "active" ? "Disable" : "Enable"}</Text>
              </TouchableOpacity>
              {/* La cuenta propia se elimina desde Perfil (DELETE /me). */}
              {isMe ? null : (
                <TouchableOpacity style={[styles.button, styles.danger]} onPress={() => confirmRemove(user, false)}>
                  <Text style={styles.dangerText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <BrandHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Users</Text>
        <Text style={styles.subtitle}>Approve registrations and manage access</Text>

        {loading && <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading &&
          SECTIONS.map(({ status, title }) => {
            const group = users.filter((u) => u.status === status);
            if (group.length === 0) return null;
            return (
              <View key={status}>
                <Text style={styles.section}>
                  {title} ({group.length})
                </Text>
                {group.map(renderUser)}
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingTop: 60 },
  content: { padding: 20, paddingBottom: 40 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backText: { color: Colors.textSecondary, fontWeight: "600" },
  title: { fontSize: 26, fontWeight: "bold", color: Colors.text },
  subtitle: { color: Colors.textSecondary, marginTop: 4, marginBottom: 8 },
  spinner: { marginTop: 30 },
  error: { color: Colors.danger, marginTop: 10 },
  section: { color: Colors.primary, fontWeight: "700", fontSize: 16, marginTop: 18, marginBottom: 8 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
  },
  name: { color: Colors.text, fontSize: 17, fontWeight: "700" },
  you: { color: Colors.textSecondary, fontWeight: "400", fontSize: 14 },
  username: { color: Colors.textSecondary, marginTop: 2 },
  label: { color: Colors.textSecondary, marginTop: 12, marginBottom: 6 },
  roles: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, textTransform: "capitalize" },
  chipTextActive: { color: Colors.text, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1 },
  primary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  buttonText: { color: Colors.text, fontWeight: "700" },
  secondary: { borderColor: Colors.border },
  secondaryText: { color: Colors.text, fontWeight: "600" },
  danger: { borderColor: Colors.danger },
  dangerText: { color: Colors.danger, fontWeight: "700" },
});
