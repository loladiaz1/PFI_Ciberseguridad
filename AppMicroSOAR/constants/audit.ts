import type { MaterialCommunityIcons } from "@expo/vector-icons";

import type { AuditCategory } from "@/types";
import { S } from "@/constants/strings";

// Iconos y categorias de la auditoria (las categorias las calcula el
// backend: orchestrator/src/audit.js). Los usan Activity y la linea de
// tiempo del incidente.
export const AUDIT_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  login: "login",
  incident_detected: "shield-alert",
  ip_blocked: "shield-lock",
  host_isolated: "lan-disconnect",
  mitigation_failed: "shield-alert-outline",
  account_deleted: "account-remove",
  alert_grouped: "layers-plus",
  user_registered: "account-plus",
  user_updated: "account-edit",
  user_removed: "account-remove-outline",
  automation_simulated: "robot-outline",
  automation_failed: "robot-dead-outline",
  automation_updated: "tune-variant",
  automation_paused: "pause-circle-outline",
  incident_closed: "check-circle-outline",
  incident_reopened: "restore",
};

export const AUDIT_CATEGORIES: { key: AuditCategory | undefined; label: string }[] = [
  { key: undefined, label: S.activity.categories.all },
  { key: "incidents", label: S.activity.categories.incidents },
  { key: "response", label: S.activity.categories.response },
  { key: "automation", label: S.activity.categories.automation },
  { key: "access", label: S.activity.categories.access },
  { key: "users", label: S.activity.categories.users },
];
