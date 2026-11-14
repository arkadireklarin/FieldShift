"use client";

import { useId, useState, type FormEvent } from "react";
import type { ClimateSummary, RecommendResponse, RotationStrategy, RotationStressTest } from "@/types/api";
import { rotationCycleLabels } from "./crop-labels";
import { exportDecisionFeedback, initialIntentLabels, type InitialIntent } from "./decision-feedback-export";
import { rotationPriorityLabels } from "./rotation-priority-labels";
import styles from "./decision-feedback.module.css";

const reasons = [
  { value: "timing", label: "Planting or harvest timing" },
  { value: "diversity", label: "Crop or crop family diversity" },
  { value: "water", label: "Water availability" },
  { value: "experience", label: "Experience with these crops" },
  { value: "market-cost", label: "Market access or cost" },
  { value: "need-more-evidence", label: "Need more evidence" },
  { value: "other", label: "Other" },
] as const;

interface DecisionFeedbackProps {
  comparison: NonNullable<RecommendResponse["rotationComparison"]>;
  strategies?: RotationStrategy[];
  robustPlan?: RotationStressTest["robustPlan"];
  harvestDeadline?: string;
  irrigationQuota?: number;
  provenance: ClimateSummary["provenance"];
  participantCode: string;
  initialIntent: InitialIntent;
}

export default function DecisionFeedback({
  comparison, strategies = [], robustPlan, harvestDeadline, irrigationQuota, provenance, participantCode, initialIntent,
}: DecisionFeedbackProps) {
  const [selection, setSelection] = useState("");
  const [status, setStatus] = useState<"idle" | "started" | "error">("idle");
  const sequenceId = useId();
  const strategiesBySequence = new Map(strategies.map((strategy) => [strategy.plan.cycles.join(","), strategy]));
  const robustSequence = robustPlan?.plan.cycles.join(",");
  const rankedChoices = comparison.alternatives.map((calendar, index) => {
    const sequenceKey = calendar.schedule.map(({ crop }) => crop).join(",");
    const strategy = strategiesBySequence.get(sequenceKey);
    strategiesBySequence.delete(sequenceKey);
    const priorities = sequenceKey === robustSequence
      ? "Best across both scenarios"
      : strategy?.priorities.map((priority) => rotationPriorityLabels[priority]).join(" / ");
    return {
      value: `plan-${index + 1}`,
      label: priorities ? `Plan ${index + 1} · ${priorities}` : `Plan ${index + 1}`,
      calendar,
    };
  });
  const choices = [
    { value: "current", label: "Current rotation", calendar: comparison.current },
    ...rankedChoices,
    ...Array.from(strategiesBySequence.values(), ({ priorities, calendar }) => ({
      value: priorities.join("+"),
      label: priorities.map((priority) => rotationPriorityLabels[priority]).join(" / "),
      calendar,
    })),
    ...(robustPlan && !comparison.alternatives.some(({ schedule }) => schedule.map(({ crop }) => crop).join(",") === robustSequence)
      ? [{ value: "both-scenarios", label: "Best across both scenarios", calendar: robustPlan.calendar }]
      : []),
    { value: "undecided", label: "Undecided", calendar: undefined },
  ];
  const choice = choices.find(({ value }) => value === selection);
  const sequence = choice?.calendar?.schedule.map(({ crop }) => crop) ?? [];

  function downloadFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice) return;

    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    try {
      exportDecisionFeedback({
        participantCode,
        initialIntent,
        currentSequence: comparison.current.schedule.map(({ crop }) => crop),
        selection: choice.value,
        sequence,
        reason,
        provenance,
        harvestDeadline,
        irrigationQuota,
      });
      setStatus("started");
    } catch {
      setStatus("error");
    }
  }

  return (
    <details className={styles.feedback} id="decision-feedback">
      <summary>Pilot decision feedback</summary>
      <p className={styles.instructions}>Ask the participant after they review the calendars. The CSV downloads to this device.</p>
      <dl className={styles.baseline}>
        <div><dt>Participant code</dt><dd>{participantCode}</dd></div>
        <div><dt>Before the demo</dt><dd>{initialIntentLabels[initialIntent]}</dd></div>
      </dl>
      <form className={styles.form} onSubmit={downloadFeedback} onChange={() => setStatus("idle")}>
        <div className={styles.inputs}>
          <label className={styles.field}>
            Which plan would you choose to try first?
            <select required value={selection} onChange={(event) => setSelection(event.target.value)} aria-describedby={sequenceId}>
              <option value="" disabled>Choose a response</option>
              {choices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Main reason <span className={styles.optional}>(optional)</span></span>
            <select name="reason" defaultValue="">
              <option value="">Select a reason</option>
              {reasons.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <p className={styles.sequence} id={sequenceId} aria-live="polite">
          {sequence.length > 0 && sequence.map((crop) => rotationCycleLabels[crop]).join(" → ")}
        </p>
        <div className={styles.actions}>
          <button type="submit">Download response (CSV)</button>
          <p className={styles.status} role="status">
            {status === "started" && "CSV download started."}
            {status === "error" && "Could not download the response. Try again."}
          </p>
        </div>
      </form>
    </details>
  );
}
