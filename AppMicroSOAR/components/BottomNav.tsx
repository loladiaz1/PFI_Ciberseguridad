import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { router, usePathname, Href } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../styles/colors";

type NavItemProps = {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: Href;
};

export default function BottomNav() {
  const pathname = usePathname();

  const Item = ({ title, icon, route }: NavItemProps) => {
    const active = pathname === route;

    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => router.push(route)}
      >
        <MaterialCommunityIcons
          name={icon}
          size={24}
          color={active ? Colors.primary : Colors.textSecondary}
        />

        <Text style={[styles.text, active && styles.active]}>
          {title}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Item
        title="Home"
        icon="view-dashboard"
        route="/dashboard"
      />

      <Item
        title="Incidents"
        icon="shield-alert"
        route="/incidents"
      />

      <Item
        title="Activity"
        icon="history"
        route="/activity"
      />

      <Item
        title="Profile"
        icon="account-circle"
        route="/profile"
      />
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