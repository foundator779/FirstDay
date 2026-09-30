import { understandingCheckSchema, type UnderstandingCheck, type InstructionCard, type UpdateUnderstandingRequest } from "@firstday/contracts";

export function createUnderstandingCheck(input: { id: string; requestId: string; instruction: InstructionCard; instructionRevision: string; explanation: string; inputMode: "voice" | "text"; timestamp: string; initialComparison?: UnderstandingCheck["initialComparison"] }): UnderstandingCheck {
  const { timestamp, ...identity } = input;
  return understandingCheckSchema.parse({ ...identity, initialComparison: input.initialComparison ?? { answerQuote:input.explanation, exceptionIndex:input.instruction.exceptions.length ? 0 : null }, createdAt: timestamp, updatedAt: timestamp, applicability: input.instruction.exceptions.map(() => null), responses: [], reviewHistory:[], version: 1, status: input.instruction.exceptions.length ? "clarifying" : "readyForConfirmation" });
}

export function updateUnderstandingCheck(check: UnderstandingCheck, input: Omit<Extract<UpdateUnderstandingRequest, { action: "clarify" }>, "checkId"> | Omit<Extract<UpdateUnderstandingRequest, { action: "confirmInterpretation" | "dispute" | "reopen" }>, "checkId">, timestamp: string): UnderstandingCheck {
  if (check.version !== input.expectedVersion || check.version >= Number.MAX_SAFE_INTEGER) throw new Error("REVISION_CONFLICT");
  if ((check.status === "disputed") !== (input.action === "reopen")) throw new Error("INVALID_STATE");
  if ((input.action === "dispute" || input.action === "reopen") && check.reviewHistory.length>=100)throw new Error("INVALID_STATE");
  if (input.action === "clarify" && (input.applicability.length !== check.instruction.exceptions.length)) throw new Error("INVALID_STATE");
  if (input.action === "confirmInterpretation" && check.status !== "readyForConfirmation") throw new Error("INVALID_STATE");
  const applicability = input.action === "clarify" ? input.applicability : input.action === "reopen" ? check.instruction.exceptions.map(()=>null) : check.applicability;
  const status = input.action === "dispute" ? "disputed" : input.action === "confirmInterpretation" ? "readyToRehearse" : applicability.includes(null) ? "clarifying" : "readyForConfirmation";
  return understandingCheckSchema.parse({ ...check, applicability, status, reviewHistory:input.action==="dispute"||input.action==="reopen"?[...check.reviewHistory,{action:input.action==="dispute"?"disputed":"reopened",version:check.version+1,createdAt:timestamp}]:check.reviewHistory, version: check.version + 1, updatedAt: timestamp });
}

export function understandingPrompt(check: UnderstandingCheck): string | null {
  if (check.status !== "readyToRehearse") return null;
  return `Rehearse this situation: ${check.instruction.situation}\n${check.instruction.exceptions.map((exception,index) => `The learner confirmed that this exception ${check.applicability[index] ? "applies" : "does not apply"}: ${exception}`).join("\n")}\nWhat will you do, and how does the confirmed action or exception support your choice?`;
}

export function understandingClarificationQuestion(instruction: InstructionCard, index: number): string {
  const exception=instruction.exceptions[index];
  if(!exception)throw new Error("INVALID_STATE");
  if(/new reservations/i.test(instruction.expectedAction) && /reservations already made/i.test(exception)) return "Was this reservation made before the policy change?";
  return "Does this exact source exception apply to your situation?";
}

export function understandingActiveAction(check: UnderstandingCheck): string | null {
  if (check.status !== "readyToRehearse" || check.applicability.includes(null)) return null;
  const duration = "(?:[1-9]\\d*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
  const newClause = new RegExp(`(^|[.\\n]\\s+)(New reservations last ${duration} days\\.)(?=\\s|$)`, "gi");
  const olderClause = new RegExp(`^Reservations already made keep their original ${duration}-day window\\.$`, "i");
  const applicable = check.instruction.exceptions.filter((_clause, index) => check.applicability[index]);
  const matches = [...check.instruction.expectedAction.matchAll(newClause)];
  let ordinaryAction = check.instruction.expectedAction;
  if (matches.length === 1 && applicable.filter(clause => olderClause.test(clause.trim())).length === 1) {
    const match = matches[0]!;
    const start = match.index! + match[1]!.length;
    // Remove only the explicit conditional sentence, never another obligation.
    ordinaryAction = `${ordinaryAction.slice(0, start)}${ordinaryAction.slice(start + match[2]!.length)}`.replace(/[ \t]{2,}/g, " ").trim();
  }
  return [ordinaryAction, ...applicable].filter(Boolean).join("\n");
}
