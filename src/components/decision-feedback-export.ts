import type { ClimateSummary, RotationCycle } from "@/types/api";

export const initialIntentLabels = {
  "keep-current": "Keep my current rotation",
  "consider-change": "Consider changing my rotation",
  undecided: "Undecided",
};

export type InitialIntent = keyof typeof initialIntentLabels;

interface DecisionFeedbackRecord {
  participantCode: string;
  initialIntent: InitialIntent;
  selection: string;
  currentSequence: readonly RotationCycle[];
  sequence: readonly RotationCycle[];
  reason: string;
  provenance: ClimateSummary["provenance"];
  harvestDeadline?: string;
  irrigationQuota?: number;
}

export const participantCodePattern = "[A-Za-z0-9][A-Za-z0-9\\-]{0,23}";

export function isParticipantCode(value: string): boolean {
  return new RegExp(`^${participantCodePattern}$`).test(value);
}

export function decisionFeedbackCsv(record: DecisionFeedbackRecord, recordedAt: Date): string {
  const { participantCode, initialIntent, selection, currentSequence, sequence, reason, provenance, harvestDeadline, irrigationQuota } = record;
  const headings = [
    "participant_code", "recorded_at_utc", "initial_intent", "post_demo_choice", "current_rotation",
    "chosen_rotation", "reason", "climate_source", "climate_period_start", "climate_period_end", "first_harvest_deadline",
    "seasonal_irrigation_quota_m3_per_da",
  ];
  const values = [
    participantCode, recordedAt.toISOString(), initialIntent, selection, currentSequence.join(" > "),
    sequence.join(" > "), reason, provenance.kind, provenance.period.start, provenance.period.end, harvestDeadline ?? "",
    irrigationQuota === undefined ? "" : String(irrigationQuota),
  ];
  return [headings, values].map((row) => row.map((value) => {
    const safeValue = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}

export function exportDecisionFeedback(record: DecisionFeedbackRecord): void {
  const blob = new Blob([decisionFeedbackCsv(record, new Date())], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fieldshift-pilot-decision.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
