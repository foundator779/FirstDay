import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createSyntheticFirstDayClient } from "./synthetic-client";
import library from "../../../fixtures/transcripts/library-onboarding.json";

// Exercise the panel's event handlers and state transitions without a DOM/native
// renderer. Effects (device drafts) are outside this recap regression.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return { ...react,
    useEffect: () => {},
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.values[index], (value: T | ((previous: T) => T)) => {
        hooks.values[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.values[index] as T) : value;
      }];
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index];
    },
  };
});
vi.mock("react-native", async () => await import("react-native-web"));
vi.mock("./draft-context", () => ({ useDraftStorage: () => ({ save: async () => {} }) }));
vi.mock("./design-assets", () => ({ Portrait: () => null, DesignIcon: () => null }));
vi.mock("./voice-rehearsal", () => ({ VoiceRehearsal: () => null }));

import { PracticePanel } from "./practice-panel";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    return [element, ...elements(element.props.children as ReactNode)];
  }
  return [];
}
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join("");
  if (node && typeof node === "object" && "props" in node) return content((node as ReactElement<{ children?: ReactNode }>).props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

describe("fresh practice after stale restoration", () => {
  it("shows newly selected rules and first-try counts without changing historical attempts", async () => {
    const client = createSyntheticFirstDayClient();
    const { sourceConversation: source } = await client.importConversation({ beeSourceId: library.id, sourceKind: "fixture", sourceRevision: library.revision, consent: { confirmed: true } });
    const extraction = await client.extractInstructions({ sourceConversationId: source.id, sourceRevision: source.sourceRevision, excludedRanges: [] });
    for (const rule of extraction.items) rule.status = (await client.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" })).instruction.status;
    const old = await client.createPractice({ sourceConversationId: source.id, sourceRevision: source.sourceRevision, instructionIds: extraction.items.map(r => r.id), title: "Earlier rehearsal" });
    const missed = await client.submitAttempt({ scenarioId: old.scenarios[0]!.id, sourceRevision: old.practiceSet.sourceRevision, instructionRevision: old.practiceSet.instructionRevision, responseText: "skip", inputMode: "text" });
    const saved = await client.getSourceSession(source.id);
    const history = structuredClone(saved.practices[0]!);
    const restoredSession = structuredClone(saved);
    restoredSession.practices[0]!.practice.practiceSet.status = "stale";
    const fourth = { ...extraction.items[2]!, id: "90000000-0000-4000-8000-000000000050", situation: "New fourth situation", expectedAction: "Use the newly selected instruction." };
    const rules = [...extraction.items, fourth];
    // The synthetic server permits only one active set. Supply the fresh API
    // receipt at the component boundary; its scenario IDs differ from history.
    const fresh = structuredClone(old);
    fresh.practiceSet.id = "90000000-0000-4000-8000-000000000060";
    fresh.scenarios = fresh.scenarios.map((scenario, index) => ({ ...scenario, id: `90000000-0000-4000-8000-00000000006${index + 1}`, practiceSetId: fresh.practiceSet.id }));
    fresh.scenarios[2] = { ...fresh.scenarios[2]!, expectedRuleIds: [fourth.id] };
    vi.spyOn(client, "createPractice").mockResolvedValue(fresh);
    vi.spyOn(client, "submitAttempt").mockResolvedValue({ ...missed, scenario: fresh.scenarios[0]!, attempt: { ...missed.attempt, id: "90000000-0000-4000-8000-000000000070", scenarioId: fresh.scenarios[0]!.id, result: "covered", matchedRuleIds: fresh.scenarios[0]!.expectedRuleIds, missedRuleIds: [] }, practiceSet: { ...fresh.practiceSet, status: "complete" }, nextAction: "complete" });
    hooks.values = []; hooks.cursor = 0;
    const render = () => {
      hooks.cursor = 0;
      return PracticePanel({ client, source, extraction: { ...extraction, items: rules }, restoredSession, onActiveChange: () => {}, onExit: () => {} });
    };
    const press = (label: string) => {
      const button = elements(render()).find(e => e.props.label === label)!;
      expect(button).toBeDefined();
      expect(button.props.disabled).not.toBe(true);
      (button.props.onPress as () => void)();
    };
    expect(content(render())).toContain("Your earlier practice history.");
    press("Choose current instructions for fresh practice");
    for (const rule of [rules[0]!, rules[1]!, fourth]) {
      const checkbox = elements(render()).find(e => e.props.accessibilityLabel === `Practise ${rule.situation}`)!;
      (checkbox.props.onPress as () => void)();
    }
    press("Start practice · 3 situations");
    await vi.waitFor(() => expect(content(render())).toContain("Your first shift"));
    expect(client.createPractice).toHaveBeenLastCalledWith(expect.objectContaining({ instructionIds: [rules[0]!.id, rules[1]!.id, fourth.id] }));
    const input = elements(render()).find(e => e.props.accessibilityLabel === "Your action")!;
    (input.props.onChangeText as (text: string) => void)("The current answer");
    press("Check my answer");
    await vi.waitFor(() => expect(elements(render()).some(e => e.props.label === "See my practice recap")).toBe(true));
    press("See my practice recap");
    const recap = content(render());
    expect(recap).toContain("Covered on your first try · 1 attempt");
    expect(recap).not.toContain("Covered after retrying");
    expect(recap).toContain(fourth.expectedAction);
    expect(recap).not.toContain(extraction.items[2]!.expectedAction);
    expect((await client.getSourceSession(source.id)).practices[0]).toEqual(history);
    expect(restoredSession.practices[0]!.attempts).toEqual(history.attempts);
  });
});
