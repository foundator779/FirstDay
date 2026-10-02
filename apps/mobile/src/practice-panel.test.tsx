import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InstructionCard } from "@firstday/contracts";
import { createSyntheticFirstDayClient } from "./synthetic-client";
import { compareTrainingUpdate } from "./practice-workflow";
import library from "../../../fixtures/transcripts/library-onboarding.json";
import update from "../../../fixtures/transcripts/library-policy-update.json";

vi.mock("react-native", async () => await import("react-native-web"));
vi.mock("./design-assets", () => ({ Portrait: () => null, DesignIcon: () => null }));
vi.mock("./voice-rehearsal", () => ({ VoiceRehearsal: () => null }));

import { PracticePanel } from "./practice-panel";
import { ChangeReview, UpdatePicker } from "./training-update-panel";
import { TranscriptCheck } from "./learner-panels";
import { initialFirstDayState } from "./state";

async function reviewed() {
  const client = createSyntheticFirstDayClient();
  const { sourceConversation: source } = await client.importConversation({ beeSourceId: library.id, sourceKind: "fixture", sourceRevision: library.revision, consent: { confirmed: true } });
  const extraction = await client.extractInstructions({ sourceConversationId: source.id, sourceRevision: source.sourceRevision, excludedRanges: [] });
  for (const rule of extraction.items) rule.status = (await client.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" })).instruction.status;
  return { client, extraction, source };
}

describe("practice preparation", () => {
  it("shows an actionable recovery when no rules are confirmed", async () => {
    const props = await reviewed();
    const markup = renderToStaticMarkup(<PracticePanel {...props} extraction={{ ...props.extraction, items: [] }} onActiveChange={() => {}} onExit={() => {}} />);
    expect(markup).toContain("Confirm 3 instructions");
    expect(markup).toContain("Choose another training conversation");
  });

  it("explains how many instructions remain instead of hiding practice", async () => {
    const props = await reviewed();
    const markup = renderToStaticMarkup(<PracticePanel {...props} extraction={{ ...props.extraction, items: props.extraction.items.slice(0, 2) }} onActiveChange={() => {}} onExit={() => {}} />);
    expect(markup).toContain("Confirm 1 more instruction");
    expect(markup).toContain("Review the remaining cards above");
  });

  it("renders a selectable card list for more than three confirmed instructions", async () => {
    const props = await reviewed();
    const fourth: InstructionCard = { ...props.extraction.items[0]!, id: "90000000-0000-4000-8000-000000000050", situation: "Fourth confirmed situation" };
    const markup = renderToStaticMarkup(<PracticePanel {...props} extraction={{ ...props.extraction, items: [...props.extraction.items, fourth] }} onActiveChange={() => {}} onExit={() => {}} />);
    expect(markup).toContain("Choose 3 instructions for this practice");
    expect(markup).toContain("Fourth confirmed situation");
    expect(markup.match(/role="checkbox"/g)).toHaveLength(4);
  });
});

describe("training update screens", () => {
  it("offers actual Bee candidates and keeps the original and fictional sources out", () => {
    const items = [
      { id: "old", title: "Original training", sourceKind: "bee", status: "processed", startedAt: library.startedAt },
      { id: "new", title: "Actual trainer update", sourceKind: "bee", status: "processed", startedAt: library.startedAt },
      { id: "fictional", title: "Fictional update", sourceKind: "fixture", status: "processed", startedAt: library.startedAt },
    ] as const;
    const markup = renderToStaticMarkup(<UpdatePicker items={items} source={{ beeSourceId: "old", sourceKind: "bee" }} busy={false} onSelect={() => {}} onMore={() => {}} hasMore={true} />);
    expect(markup).toContain("Actual trainer update");
    expect(markup).not.toContain("Original training");
    expect(markup).not.toContain("Fictional update");
    expect(markup).toContain("Load more conversations");
  });

  it("requires permission on the reviewed second transcript and labels the comparison action", async () => {
    const { client } = await reviewed();
    const { conversation: source } = await client.getConversation({ beeSourceId: update.id, sourceKind: "fixture" });
    const markup = renderToStaticMarkup(<TranscriptCheck preview={{ phase: "ready", source, excludedRanges: [], consentConfirmed: false, message: null }} review={initialFirstDayState.review} aiMode={false} onBack={() => {}} onRetry={() => {}} onToggle={() => {}} onConsent={() => {}} onExtract={() => {}} actionLabel="Use this update and compare" locked={false} />);
    expect(markup).toContain("Confirm permission to use this conversation");
    expect(markup).toContain("Use this update and compare");
    expect(markup).toContain("aria-disabled=\"true\"");
  });

  it("renders every proposed change with its source quotes and explicit confirmation", async () => {
    const props = await reviewed();
    const { conversation: newSource } = await props.client.getConversation({ beeSourceId: update.id, sourceKind: "fixture" });
    const result = await compareTrainingUpdate(props.client, { previousSource: props.source, previousInstructionRevision: props.extraction.instructionRevision, update: newSource, excludedRanges: [], consentConfirmed: true }, {});
    const second = { ...result.changes[0]!, id: "90000000-0000-4000-8000-000000000060", replacementInstruction: { ...result.changes[0]!.replacementInstruction, expectedAction: "Second independently reviewable action" } };
    const markup = renderToStaticMarkup(<ChangeReview comparison={{ ...result, changes: [...result.changes, second] }} previousRules={props.extraction.items} busy={false} onConfirm={() => {}} />);
    expect(markup).toContain("Second independently reviewable action");
    expect(markup.match(/Confirm update/g)).toHaveLength(2);
    expect(markup).toContain(result.sourceEvidence[0]!.quote);
  });

  it("explains an empty comparison without inventing a change", async () => {
    const props = await reviewed();
    const markup = renderToStaticMarkup(<ChangeReview comparison={{ previousSourceConversationId: props.source.id, newSourceConversationId: "90000000-0000-4000-8000-000000000070", previousInstructionRevision: props.extraction.instructionRevision, changes: [], sourceEvidence: [] }} previousRules={props.extraction.items} busy={false} onConfirm={() => {}} />);
    expect(markup).toContain("No explicit instruction change found");
    expect(markup).not.toContain("Confirm update");
  });

  it("distinguishes already-confirmed changes from an empty comparison", async () => {
    const props = await reviewed();
    const markup = renderToStaticMarkup(<ChangeReview comparison={{ previousSourceConversationId: props.source.id, newSourceConversationId: "90000000-0000-4000-8000-000000000070", previousInstructionRevision: props.extraction.instructionRevision, changes: [], sourceEvidence: [] }} previousRules={props.extraction.items} busy={false} onConfirm={() => {}} confirmedCount={1} />);
    expect(markup).toContain("All proposed changes are confirmed");
    expect(markup).not.toContain("No explicit instruction change found");
    expect(markup).not.toContain("earlier practice stays as it was");
  });
});

it('excludes a source-correction withholding card and gives actionable fewer-than-three recovery',async()=>{
  const {client,source,extraction}=await reviewed();
  const markup=renderToStaticMarkup(<PracticePanel client={client} source={source} extraction={extraction} withheldInstructionIds={[extraction.items[0]!.id]} onActiveChange={()=>{}} onExit={()=>{}}/>);
  expect(markup).toContain('Grading paused by source correction');
  expect(markup).toContain('Confirm 1 more instruction');
  expect(markup).toContain('Choose another training conversation');
});
