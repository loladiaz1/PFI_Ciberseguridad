import Colors from '../styles/colors';
import { S } from "@/constants/strings";

// Wazuh rule.level va de 0 a 15. Umbrales usuales de su documentacion.
// Reglas de Wazuh del incidente (agrupado o no).
export function incidentRules(incident: { ruleId: string; ruleIds: string | null }): string[] {
  return incident.ruleIds ? JSON.parse(incident.ruleIds) : [incident.ruleId];
}

export function severityLabel(severity: number) {
  if (severity >= 12) return { label: S.severity.critical, color: Colors.danger };
  if (severity >= 7) return { label: S.severity.high, color: Colors.primary };
  if (severity >= 4) return { label: S.severity.medium, color: Colors.warning };
  return { label: S.severity.low, color: Colors.success };
}
