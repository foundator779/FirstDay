import { describe, expect, it } from "vitest";
import type { Attempt, InstructionCard } from "@firstday/contracts";
import { practiceRecap } from "./practice-recap";

describe("practice recap", () => {
  it("counts retries once, ignores other rules, and never reports a partial answer as covered", () => {
    const rules = ["old", "new", "unpractised"].map((id) => ({ id } as InstructionCard));
    let sequence = 0;
    const attempt = (rule: string, result: Attempt["result"]): Attempt => ({ id: String(++sequence), result, matchedRuleIds: result === "covered" ? [rule] : [], missedRuleIds: result === "covered" ? [] : [rule] } as Attempt);
    const missed = attempt("old", "missed");
    const attempts = [missed, missed, attempt("old", "covered"), attempt("new", "partial"), attempt("unrelated", "covered")];
    expect(practiceRecap(rules, attempts).map(({ covered, tries, retried }) => ({ covered, tries, retried }))).toEqual([
      { covered: true, tries: 2, retried: true }, { covered: false, tries: 1, retried: false }, { covered: false, tries: 0, retried: false },
    ]);
  });
});
