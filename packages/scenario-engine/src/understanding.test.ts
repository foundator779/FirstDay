import { describe, expect, it } from "vitest";
import { createUnderstandingCheck, updateUnderstandingCheck, understandingPrompt, understandingActiveAction } from "./understanding.js";
import type { InstructionCard } from "@firstday/contracts";
const instruction: InstructionCard = { id: "11111111-1111-4111-8111-111111111111", sourceConversationId: "22222222-2222-4222-8222-222222222222", sourceRevision: "r1", text: "Reservation windows", situation: "A reservation is four days old", expectedAction: "New reservations last three days.", exceptions: ["Reservations already made keep their original seven-day window."], status: "confirmed", confidence: 1, sourceEvidence: [`evd_${"a".repeat(64)}`], createdAt: "2026-09-30T12:00:00.000Z", updatedAt: "2026-09-30T12:00:00.000Z" };
const base = () => createUnderstandingCheck({ id: "33333333-3333-4333-8333-333333333333", requestId: "44444444-4444-4444-8444-444444444444", instruction, instructionRevision: "ir1", explanation: "I would cancel this four-day-old reservation.", inputMode: "voice", timestamp: instruction.createdAt });
describe("source-backed understanding dialogue", () => {
  it("asks the unknown exception context before allowing rehearsal", () => {
    const check = base(); expect(check.status).toBe("clarifying"); expect(check.applicability).toEqual([null]);
    expect(() => updateUnderstandingCheck(check, { action: "confirmInterpretation", expectedVersion: 1 }, instruction.createdAt)).toThrow();
    const unknown = updateUnderstandingCheck(check, { action: "clarify", expectedVersion: 1, applicability: [null] }, instruction.createdAt);
    expect(unknown.status).toBe("clarifying"); expect(understandingPrompt(unknown)).toBeNull();
  });
  it.each([true, false])("rehearses the exact older/newer distinction after explicit confirmation (%s)", applies => {
    let check = updateUnderstandingCheck(base(), { action: "clarify", expectedVersion: 1, applicability: [applies] }, instruction.createdAt);
    expect(check.status).toBe("readyForConfirmation"); expect(understandingPrompt(check)).toBeNull();
    check = updateUnderstandingCheck(check, { action: "confirmInterpretation", expectedVersion: 2 }, instruction.createdAt);
    expect(check.status).toBe("readyToRehearse"); expect(understandingPrompt(check)).toContain(applies ? "applies" : "does not apply");
    expect(understandingPrompt(check)).toContain(instruction.exceptions[0]);
  });
  it("blocks a disputed interpretation and rejects incomplete or stale context", () => {
    const check = base(); expect(() => updateUnderstandingCheck(check, { action: "clarify", expectedVersion: 1, applicability: [] }, instruction.createdAt)).toThrow();
    expect(() => updateUnderstandingCheck(check, { action: "clarify", expectedVersion: 0, applicability: [true] }, instruction.createdAt)).toThrow();
    const disputed = updateUnderstandingCheck(check, { action: "dispute", expectedVersion: 1 }, instruction.createdAt);
    expect(disputed.status).toBe("disputed"); expect(understandingPrompt(disputed)).toBeNull();
    expect(() => updateUnderstandingCheck(disputed, { action: "confirmInterpretation", expectedVersion: 2 }, instruction.createdAt)).toThrow();
  });
});

it("reopens a dispute explicitly with unknown context and retains its review history",()=>{let check=updateUnderstandingCheck(base(),{action:"dispute",expectedVersion:1},instruction.createdAt);check=updateUnderstandingCheck(check,{action:"reopen",expectedVersion:2},instruction.createdAt);expect(check.status).toBe("clarifying");expect(check.applicability).toEqual([null]);expect(check.reviewHistory.map(e=>e.action)).toEqual(["disputed","reopened"]);});

it.each([
  ["three", "seven"],
  ["two", "nine"],
  ["2", "9"],
])("uses only the applicable older duration while retaining the immutable new%s/old%s source", (newDays, oldDays) => {
  const check = { ...base(), status: "readyToRehearse" as const, instruction: { ...instruction, expectedAction: `New reservations last ${newDays} days.`, exceptions: [`Reservations already made keep their original ${oldDays}-day window.`] }, applicability: [true] };
  expect(understandingActiveAction(check)).toBe(check.instruction.exceptions[0]);
  expect(check.instruction.expectedAction).toBe(`New reservations last ${newDays} days.`);
  expect(understandingActiveAction({ ...check, applicability: [false] })).toBe(check.instruction.expectedAction);
});

it("removes only the inactive new-reservation sentence from a mixed mandatory action", () => {
  const check = { ...base(), status: "readyToRehearse" as const, instruction: { ...instruction, expectedAction: "Check the reservation record. New reservations last two days. Record the decision.", exceptions: ["Reservations already made keep their original nine-day window.", "Use the accessible desk if needed."] }, applicability: [true, true] };
  expect(understandingActiveAction(check)).toBe("Check the reservation record. Record the decision.\nReservations already made keep their original nine-day window.\nUse the accessible desk if needed.");
});

it("retains unaffected ordinary steps and generic additive exceptions, withholding unknown context", () => {
  const check = { ...base(), status: "readyToRehearse" as const, instruction: { ...instruction, expectedAction: "Check the customer ID and reservation code.", exceptions: ["A manager may provide a lost reservation code."] }, applicability: [true] };
  expect(understandingActiveAction(check)).toBe("Check the customer ID and reservation code.\nA manager may provide a lost reservation code.");
  expect(understandingActiveAction({ ...check, applicability: [null] })).toBeNull();
});
