import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { SourceConversation, SourceKind, SourceSessionResponse } from "@firstday/contracts";
import type { FirstDayClient } from "./api";
import { Action, Loading, ui } from "./learner-panels";

export function SavedTraining({ client, sourceKind, onRestore }: { client: FirstDayClient; sourceKind: SourceKind; onRestore(session: SourceSessionResponse): void }) {
  const [items, setItems] = useState<SourceConversation[]>([]);
  const [opened, setOpened] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    const controller = new AbortController(); request.current = controller;
    try { await operation(controller.signal); }
    catch { if (!controller.signal.aborted) setError("Saved training couldn’t be loaded. Check your connection and try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function load(cursor?: string) {
    await run(async (signal) => {
      const page = await client.listSavedSources({ sourceKind, limit: 20, ...(cursor ? { cursor } : {}) }, signal);
      if (signal.aborted) return;
      setItems((old) => [...new Map([...(cursor ? old : []), ...page.items].map((s) => [s.id, s])).values()]);
      setNextCursor(page.nextCursor); setOpened(true);
    });
  }
  async function restore(id: string) {
    await run(async (signal) => {
      const session = await client.getSourceSession(id, signal);
      if (!signal.aborted) onRestore(session);
    });
  }
  return <View style={ui.section}>
    <Action secondary label={opened ? "Refresh saved training" : "Resume saved training"} disabled={busy} onPress={() => void load()} />
    {opened && <View style={ui.paper}><Text accessibilityRole="header" style={ui.label}>Your saved training</Text><Text style={ui.meta}>Resume the saved review, attempts and current practice. Source consent is checked again.</Text>{items.length === 0 && <Text style={ui.body}>No saved training in this mode yet.</Text>}{items.map((s) => <View key={s.id} style={ui.gap}><Text style={ui.body}>{s.title}</Text><Text style={ui.meta}>Imported {s.importedAt.slice(0, 10)} · {s.sourceKind === "fixture" ? "Fictional source" : "Bee recording"}</Text><Action secondary label={`Resume ${s.title}`} disabled={busy} onPress={() => void restore(s.id)} /></View>)}{nextCursor && <Action secondary label="Load more saved training" disabled={busy} onPress={() => void load(nextCursor)} />}</View>}
    {busy && <Loading label="Loading saved training…" />}
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
  </View>;
}
