import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { Header } from "@/components/Header";
import { getStoredUser } from "@/services/auth";
import { updateUser } from "@/services/api";
import { clearToken } from "@/services/tokenStore";
import Colors from "@/styles/colors";
import type { UserProfile } from "@/types";

export default function ProfileScreen() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getStoredUser()
        .then((data) => {
          if (cancelled) return;
          setUser(data);
          setName(data.name);
          setEmail(data.email);
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

  const startEditing = () => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setEditing(false);
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await clearToken();
          router.replace("/");
        },
      },
    ]);
  };

  const saveProfile = async () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert("Invalid data", "Name and email are required.");
      return;
    }

    try {
      setSaving(true);
      const updated = await updateUser({ name: name.trim(), email: email.trim() });
      setUser(updated);
      setEditing(false);
    } catch {
      Alert.alert("Unable to update profile", "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <BrandHeader />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !user) {
    return (
      <View style={styles.container}>
        <BrandHeader />
        <View style={[styles.centered, styles.emptyState]}>
          <MaterialCommunityIcons name="account-alert-outline" size={48} color={Colors.textSecondary} />
          <Text style={styles.value}>{error || "No user session"}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BrandHeader />
      <Header title="Profile" subtitle="Account details" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatarPlaceholder}>
            <MaterialCommunityIcons name="account" size={56} color={Colors.textSecondary} />
          </View>
        </View>

        {editing ? (
          <View style={styles.card}>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} />

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{user.role}</Text>

            <View style={styles.editActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={cancelEditing} disabled={saving}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={saveProfile} disabled={saving}>
                <Text style={styles.saveButtonText}>{saving ? "Saving..." : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{user.name}</Text>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{user.email}</Text>
            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{user.role}</Text>

            <TouchableOpacity style={styles.editButton} onPress={startEditing}>
              <MaterialCommunityIcons name="pencil" size={16} color={Colors.primary} />
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={18} color={Colors.danger} />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
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

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyState: {
    flex: 1,
    gap: 10,
  },

  content: {
    padding: 20,
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
