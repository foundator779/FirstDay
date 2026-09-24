import type { Attempt, InstructionCard } from "@firstday/contracts";

/** A record of this rehearsal, not a prediction of workplace performance. */
export function practiceRecap(instructions: readonly InstructionCard[], attempts: readonly Attempt[]) {
  const unique = [...new Map(attempts.map((attempt) => [attempt.id, attempt])).values()];
  return instructions.map((instruction) => {
    const relevant = unique.filter((attempt) => [...attempt.matchedRuleIds, ...attempt.missedRuleIds].includes(instruction.id));
    const covered = relevant.some((attempt) => attempt.result === "covered" && attempt.matchedRuleIds.includes(instruction.id));
    return { instruction, covered, tries: relevant.length, retried: covered && relevant.length > 1 };
  });
}
