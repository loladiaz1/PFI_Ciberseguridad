import Colors from '../styles/colors';

// Wazuh rule.level va de 0 a 15. Umbrales usuales de su documentacion.
export function severityLabel(severity: number) {
  if (severity >= 12) return { label: 'CRITICAL', color: Colors.danger };
  if (severity >= 7) return { label: 'HIGH', color: Colors.primary };
  if (severity >= 4) return { label: 'MEDIUM', color: Colors.warning };
  return { label: 'LOW', color: Colors.success };
}
