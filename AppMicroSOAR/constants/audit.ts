import type { MaterialCommunityIcons } from "@expo/vector-icons";

import type { AuditCategory } from "@/types";

// Iconos y categorias de la auditoria (las categorias las calcula el
// backend: orchestrator/src/audit.js). Los usan Activity y la linea de
// tiempo del incidente.
export const AUDIT_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  login: "login",
  incident_detected: "shield-alert",
  ip_blocked: "shield-lock",
  host_isolated: "lan-disconnect",
  account_deleted: "account-remove",
  alert_grouped: "layers-plus",
  user_registered: "account-plus",
  user_updated: "account-edit",
  user_removed: "account-remove-outline",
  automation_simulated: "robot-outline",
  automation_failed: "robot-dead-outline",
  automation_updated: "tune-variant",
};

export const AUDIT_CATEGORIES: { key: AuditCategory | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "incidents", label: "Incidents" },
  { key: "response", label: "Response" },
  { key: "automation", label: "Automation" },
  { key: "access", label: "Access" },
  { key: "users", label: "Users" },
];
