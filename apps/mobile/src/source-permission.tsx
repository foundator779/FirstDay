import { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { SourceConversation } from "@firstday/contracts";
import type { FirstDayClient } from "./api";
import { useDraftStorage } from "./draft-context";
import { Action, Loading, ui } from "./learner-panels";
import { revokeConfirmedSource } from "./source-permission-workflow";

export function SourcePermission({ client, source, onRevoked }: { client: FirstDayClient; source: SourceConversation; onRevoked(message: string): void }) {
  const draftStorage=useDraftStorage();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function revoke() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      await revokeConfirmedSource(client, source);
      let message = "Permission revoked. This source is no longer available for practice or saved training.";
      try { await draftStorage.clearOwner(source.learnerId); }
      catch { message += " Some device drafts couldn’t be cleared. Retry Clear local answer drafts in About."; }
      onRevoked(message);
    } catch { setError("Permission couldn’t be revoked. Check your connection and try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <View style={ui.paper}>
    <Text style={ui.blueLabel}>Permission for this source</Text>
    <Text style={ui.body}>{source.title}</Text><Text style={ui.meta}>Revision: {source.sourceRevision}</Text>
    {!reviewing ? <Action secondary label="Review source permission" onPress={() => setReviewing(true)} /> : <>
      <Text style={ui.label}>Stop using this training in FirstDay?</Text>
      <Text style={ui.body}>This removes FirstDay’s imported transcript and extraction inputs, blocks dependent practice, and hides this source from saved training. Earlier attempt records are retained. This applies to FirstDay’s copy.</Text>
      <Action secondary label="Keep permission" disabled={busy} onPress={() => setReviewing(false)} />
      <Action label="Revoke permission for this source" disabled={busy} onPress={() => void revoke()} />
    </>}
    {busy && <Loading label="Revoking source permission…" />}
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
  </View>;
}
