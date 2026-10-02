import { createAttemptResponseSchema, sourceSessionResponseSchema, type CreateAttemptResponse, type SourceSessionResponse } from "@firstday/contracts";

export function restorePractice(input: SourceSessionResponse) {
  const session = sourceSessionResponseSchema.parse(input);
  const saved = session.practices.filter((p) => p.practice.practiceSet.status !== "stale" && p.practice.practiceSet.status !== "draft").at(-1) ?? session.practices.filter((p) => p.practice.practiceSet.status === "stale").at(-1);
  if (!saved) return null;
  const { practice, attempts } = saved;
  const stale = practice.practiceSet.status === "stale";
  const covered = new Set(attempts.filter((a) => a.result === "covered").map((a) => a.scenarioId));
  const pending = practice.scenarios.findIndex((s) => !covered.has(s.id));
  const index = Math.max(0, pending);
  const showRecap = stale || practice.practiceSet.status === "complete";
  const scenario = practice.scenarios[index];
  const latest = [...attempts].reverse().find((a) => a.scenarioId === scenario?.id);
  let feedback: CreateAttemptResponse | null = null;
  if (!showRecap && scenario && latest && latest.result !== "covered") {
    const ids = [...scenario.expectedRuleIds, ...(practice.changeProposal ? [practice.changeProposal.previousInstructionId] : [])];
    feedback = createAttemptResponseSchema.parse({ practiceSet: practice.practiceSet, scenario, attempt: latest, instructions: practice.instructions.filter((r) => ids.includes(r.id)), ...(practice.changeProposal ? { changeProposal: practice.changeProposal } : {}), sourceEvidence: practice.sourceEvidence.filter((e) => scenario.sourceEvidence.includes(e.id)), nextAction: latest.result === "needsReview" ? "reviewSource" : "retry" });
  }
  const change = practice.changeProposal;
  const previous = change ? practice.instructions.find((r) => r.id === change.previousInstructionId) : undefined;
  return { practice, attempts, index, feedback, showRecap, stale, changePair: previous && change ? { before: previous, after: change.replacementInstruction } : null };
}
