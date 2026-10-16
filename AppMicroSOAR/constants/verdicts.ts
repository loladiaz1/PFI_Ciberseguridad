import Colors from "@/styles/colors";
import type { Verdict } from "@/types";
import { S } from "@/constants/strings";

// Veredictos del cierre de un caso (orchestrator/src/closure.js): texto,
// color y ayuda para elegirlo.
export const VERDICTS: Record<Verdict, { label: string; color: string; help: string }> = {
  true_positive: {
    ...S.verdicts.true_positive,
    color: Colors.danger,
  },
  benign_positive: {
    ...S.verdicts.benign_positive,
    color: Colors.warning,
  },
  false_positive: {
    ...S.verdicts.false_positive,
    color: Colors.textSecondary,
  },
};

export function tagsOf(incident: { tags: string }): string[] {
  return incident.tags ? JSON.parse(incident.tags) : [];
}
