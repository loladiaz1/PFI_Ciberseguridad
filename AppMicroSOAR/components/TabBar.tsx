import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Colors from "@/styles/colors";

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  dashboard: "view-dashboard",
  incidents: "shield-alert",
  activity: "history",
  profile: "account-circle",
};

const LABELS: Record<string, string> = {
  dashboard: "Home",
  incidents: "Incidents",
  activity: "Activity",
  profile: "Profile",
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.container}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;

        return (
          <TouchableOpacity
            key={route.key}
            style={styles.item}
            onPress={() => navigation.navigate(route.name)}
          >
            <MaterialCommunityIcons
              name={ICONS[route.name] ?? "circle"}
              size={24}
              color={focused ? Colors.primary : Colors.textSecondary}
            />

            <Text style={[styles.text, focused && styles.active]}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 85,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingBottom: 10,
  },

  item: {
    alignItems: "center",
    justifyContent: "center",
  },

  text: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "500",
  },

  active: {
    color: Colors.primary,
    fontWeight: "700",
  },
});
