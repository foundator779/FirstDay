import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { BeeConversationSummary, CompareSourceResponse, ConfirmChangeResponse, ExcludedRange, InstructionCard, SourceConversation, SourceSessionResponse } from "@firstday/contracts";
import type { PracticeClient } from "./synthetic-client";
import { SYNTHETIC_UPDATES } from "./synthetic-client";
import { FirstDayClientError } from "./api";
import { Action, EvidenceNotes, Loading, TranscriptCheck, ui } from "./learner-panels";
import { compareTrainingUpdate, restoredComparison, updateCandidates, type UpdateCheckpoint } from "./practice-workflow";
import { transcriptSelectionsOverlap, excludedRangeForUtterance } from "@firstday/contracts";
import { initialFirstDayState, type PreviewState } from "./state";

export function UpdatePicker({ items, source, busy, hasMore, onMore, onSelect }: { items: readonly BeeConversationSummary[]; source: Pick<SourceConversation, "beeSourceId" | "sourceKind">; busy: boolean; hasMore: boolean; onMore(): void; onSelect(id: string): void }) {
  const candidates = updateCandidates(items, source);
  const suggested = source.sourceKind === "fixture" ? SYNTHETIC_UPDATES[source.beeSourceId] : undefined;
  const ordered = [...candidates].sort((left, right) => Number(right.id === suggested) - Number(left.id === suggested));
  return <View style={ui.section}>
    <Text accessibilityRole="header" style={ui.title}>Choose a later conversation.</Text>
    <Text style={ui.body}>Select the conversation where your trainer explained the update. You will review its transcript and permission before comparing.</Text>
    <Text style={ui.meta}>{source.sourceKind === "fixture" ? "Fictional conversations" : "Processed conversations from Bee"}</Text>
    {ordered.map((item) => <View key={item.id} style={ui.paper}>
      <Text style={ui.label}>{item.title}</Text><Text style={ui.meta}>{item.startedAt.slice(0, 10)}</Text>
      <Action secondary label={item.id === suggested ? "Review the example update" : `Review ${item.title}`} disabled={busy} onPress={() => onSelect(item.id)} />
    </View>)}
    {!candidates.length && !busy && <Text style={ui.body}>No other processed conversations found. Refresh after Bee has finished processing your next training conversation, or try another search.</Text>}
    {hasMore && <Action secondary label="Load more conversations" disabled={busy} onPress={onMore} />}
  </View>;
}

export function ChangeReview({ comparison, previousRules, busy, onConfirm, confirmedCount = 0 }: { comparison: CompareSourceResponse; previousRules: readonly InstructionCard[]; busy: boolean; onConfirm(id: string): void; confirmedCount?: number }) {
  if (!comparison.changes.length && confirmedCount > 0) return <View style={ui.paper}>
    <Text accessibilityRole="header" style={ui.label}>All proposed changes are confirmed</Text>
    <Text style={ui.body}>You reviewed {confirmedCount} change{confirmedCount === 1 ? "" : "s"} from this conversation. Affected earlier practice remains out of date. Choose another conversation to check for a later update.</Text>
  </View>;
  if (!comparison.changes.length) return <View style={ui.paper}>
    <Text accessibilityRole="header" style={ui.label}>No explicit instruction change found</Text>
    <Text style={ui.body}>The included passages did not establish a replacement for a confirmed instruction. Your earlier practice stays as it was. Choose another conversation or ask your trainer to clarify.</Text>
  </View>;
  return <View style={ui.section}>
    <Text accessibilityRole="header" style={ui.title}>{comparison.changes.length === 1 ? "One instruction may have changed." : `${comparison.changes.length} instructions may have changed.`}</Text>
    <Text style={ui.body}>Review each proposal against both sources. Confirming a change marks affected earlier practice out of date and creates a new situation.</Text>
    {comparison.changes.map((change) => {
      const previous = previousRules.find((rule) => rule.id === change.previousInstructionId);
      const references = new Set([...change.previousSourceEvidence, ...change.replacementInstruction.sourceEvidence]);
      return <View key={change.id} style={ui.paper}>
        <Text style={ui.meta}>Earlier instruction</Text><Text selectable style={ui.body}>{previous?.expectedAction ?? "See the earlier source below."}</Text>
        <Text style={ui.blueLabel}>Updated instruction</Text><Text selectable style={ui.inkBody}>{change.replacementInstruction.expectedAction}</Text>
        {change.replacementInstruction.exceptions.map((exception) => <Text key={exception} style={ui.body}>Exception: {exception}</Text>)}
        <EvidenceNotes items={comparison.sourceEvidence.filter((evidence) => references.has(evidence.id))} />
        <Action label="Confirm update & practise it" disabled={busy} onPress={() => onConfirm(change.id)} />
      </View>;
    })}
  </View>;
}

type Props = {
  restoredSession?: SourceSessionResponse | undefined;
  visible: boolean;
  client: PracticeClient;
  source: SourceConversation;
  instructionRevision: string;
  previousRules: readonly InstructionCard[];
  aiMode: boolean;
  onClose(): void;
  onConfirmed(response: ConfirmChangeResponse): void;
  onStepChange?(): void;
};

/** Keeps successful update stages and remaining proposals while a drill is practised. */
export function TrainingUpdatePanel({ visible, client, source, instructionRevision, previousRules, aiMode, onClose, onConfirmed, onStepChange, restoredSession }: Props) {
  const [restored] = useState(() => restoredSession ? restoredComparison(restoredSession, source.id, instructionRevision) : null);
  const [items, setItems] = useState<BeeConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const loadedQuery = useRef("");
  const [preview, setPreview] = useState<PreviewState>(initialFirstDayState.preview);
  const [comparison, setComparison] = useState<CompareSourceResponse | null>(restored?.comparison ?? null);
  const [confirmedCount, setConfirmedCount] = useState(restored?.confirmedCount ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const checkpoints = useRef(new Map<string, { checkpoint: UpdateCheckpoint; excludedRanges: ExcludedRange[] }>());
  const checkpointKey = preview.source ? JSON.stringify([preview.source.id, preview.source.revision]) : "";
  const checkpoint = checkpoints.current.get(checkpointKey);

  const run = useCallback(async (label: string, operation: (signal: AbortSignal) => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    const controller = new AbortController(); request.current = controller;
    setBusy(label); setError(null);
    try { await operation(controller.signal); }
    catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof FirstDayClientError || failure instanceof Error ? failure.message : "This step could not finish. Please try again.");
    } finally { lock.current = false; setBusy(null); }
  }, []);

  const load = useCallback(async (cursor?: string, search = "") => {
    await run("Loading later conversations…", async (signal) => {
      const page = await client.listConversations({ sourceKind: source.sourceKind, limit: 20, ...(search.trim() ? { query: search.trim() } : {}), ...(cursor ? { cursor } : {}) }, signal);
      if (signal.aborted) return;
      setItems((previous) => [...new Map([...(cursor ? previous : []), ...page.items].map((item) => [item.id, item])).values()]);
      loadedQuery.current = search; setNextCursor(page.nextCursor); setLoaded(true);
    });
  }, [client, run, source.sourceKind]);

  useEffect(() => {
    if (visible && !loaded) void load();
    return () => request.current?.abort();
  }, [visible, loaded, load]);

  async function choose(id: string) {
    await run("Opening the update transcript…", async (signal) => {
      const { conversation } = await client.getConversation({ beeSourceId: id, sourceKind: source.sourceKind }, signal);
      if (signal.aborted) return;
      const key = JSON.stringify([conversation.id, conversation.revision]);
      const saved = checkpoints.current.get(key);
      setPreview({ phase: "ready", source: conversation, excludedRanges: saved?.excludedRanges ?? [], consentConfirmed: saved?.checkpoint.source !== undefined, message: null });
      setComparison(null); setConfirmedCount(0); onStepChange?.();
    });
  }

  async function compare() {
    if (!preview.source) return;
    await run("Comparing the two sources…", async (signal) => {
      let saved = checkpoints.current.get(checkpointKey);
      if (!saved) {
        saved = { checkpoint: {}, excludedRanges: structuredClone(preview.excludedRanges) };
        checkpoints.current.set(checkpointKey, saved);
      }
      if (!saved.checkpoint.source) {
        saved.excludedRanges = structuredClone(preview.excludedRanges);
        delete saved.checkpoint.reviewIdentity;
      }
      let result: CompareSourceResponse;
      try {
        result = await compareTrainingUpdate(client, { previousSource: source, previousInstructionRevision: instructionRevision, update: preview.source!, excludedRanges: saved.excludedRanges, consentConfirmed: preview.consentConfirmed }, saved.checkpoint);
      } catch (failure) {
        if (saved.checkpoint.excludedRanges) {
          saved.excludedRanges = saved.checkpoint.excludedRanges;
          setPreview((value) => ({ ...value, excludedRanges: saved!.excludedRanges }));
        }
        throw failure;
      }
      // Preserve a completed server stage even when navigation cancels its display.
      setComparison(result);
      setConfirmedCount(saved.checkpoint.confirmedCount ?? 0);
      if (!signal.aborted) onStepChange?.();
    });
  }

  async function confirm(id: string) {
    const change = comparison?.changes.find((item) => item.id === id);
    if (!change) return;
    await run("Updating your practice…", async () => {
      const response = await client.confirmChange({ changeId: id, sourceRevision: change.sourceRevision });
      setComparison((previous) => previous ? { ...previous, changes: previous.changes.filter((item) => item.id !== id) } : null);
      setConfirmedCount((count) => count + 1);
      onConfirmed(response);
    });
  }

  if (!visible) return null;
  return <View style={ui.section}>
    {!preview.source && !comparison && <>
      <TextInput accessibilityLabel="Search later training conversations" placeholder="Search later training" value={query} onChangeText={setQuery} style={ui.input} editable={!busy} />
      <Action secondary label={loaded ? "Search conversations" : "Reload conversations"} disabled={!!busy} onPress={() => void load(undefined, query)} />
      <UpdatePicker items={items} source={source} busy={!!busy} hasMore={nextCursor !== null} onMore={() => { if (nextCursor) void load(nextCursor, loadedQuery.current); }} onSelect={(id) => void choose(id)} />
    </>}
    {preview.source && !comparison && <TranscriptCheck preview={preview} review={initialFirstDayState.review} aiMode={aiMode} actionLabel="Use this update and compare" working={!!busy} locked={!!busy || checkpoint?.checkpoint.source !== undefined} onBack={() => { if (!busy) setPreview(initialFirstDayState.preview); }} onRetry={() => { if (preview.source) void choose(preview.source.id); }} onConsent={(confirmed) => setPreview((value) => ({ ...value, consentConfirmed: confirmed }))} onToggle={(utterance) => setPreview((value) => ({ ...value, excludedRanges: value.excludedRanges.some((range) => transcriptSelectionsOverlap(range, utterance)) ? value.excludedRanges.filter((range) => !transcriptSelectionsOverlap(range, utterance)) : [...value.excludedRanges, excludedRangeForUtterance(utterance)] }))} onExtract={() => void compare()} />}
    {comparison && <>
      <ChangeReview comparison={comparison} previousRules={previousRules} busy={!!busy} onConfirm={(id) => void confirm(id)} confirmedCount={confirmedCount} />
      <Action secondary label="Choose another update conversation" disabled={!!busy} onPress={() => { setComparison(null); setPreview(initialFirstDayState.preview); onStepChange?.(); }} />
    </>}
    {busy && <Loading label={busy} />}
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    <Action secondary label="Back to my recap" disabled={!!busy} onPress={onClose} />
  </View>;
}
