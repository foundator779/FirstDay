import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { buzz } from "../src/device";
import type { SuggestedRule } from "../src/logic/types";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, Chip, Dots, Label, Quote, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Target = { kind: "new" } | { kind: "pack"; packId: string };

/**
 * FirstDay's confirm step: every instruction is checked against the exact quote
 * before it can become practice. Nothing is practised that you didn't confirm.
 */
export default function Confirm() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { state, actions } = useStore();
  const { s } = useUI();
  const queue = useMemo<SuggestedRule[]>(
    () => state.suggestedRules.filter((r) => !from || r.fromId === from),
    // Snapshot on open.
    [],
  );
  const source = state.conversations.find((c) => c.id === (from ?? queue[0]?.fromId));
  const [stage, setStage] = useState<"target" | "check" | "done">("target");
  const [target, setTarget] = useState<Target>({ kind: "new" });
  const [title, setTitle] = useState(source?.title.replace(/^Training:\s*/, "") ?? "");
  const [trainer, setTrainer] = useState("");
  const [i, setI] = useState(0);
  const [kept, setKept] = useState<SuggestedRule[]>([]);
  const [edit, setEdit] = useState<{ situation: string; action: string } | null>(null);
  const [outcome, setOutcome] = useState<{ packId: string; updates: number; added: number } | null>(null);

  const field = { fontFamily: fonts.body, fontSize: s.body, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.faint, paddingVertical: 10 } as const;

  if (queue.length === 0) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <TopBar onBack={() => router.back()} title="Work steps" />
        <Txt>No new work steps to check. Paste a training conversation with + to find some.</Txt>
      </Screen>
    );
  }

  const save = (list: SuggestedRule[]) => {
    if (!list.length) {
      for (const r of queue) actions.dismissRule(r.id);
      setStage("done");
      setOutcome(null);
      return;
    }
    const sourceText = [...new Set(list.map((r) => r.fromId))]
      .map((id) => state.conversations.find((c) => c.id === id)?.text ?? "")
      .filter(Boolean)
      .join("\n\n");
    const res = actions.saveConfirmedRules(
      list,
      target.kind === "pack" ? { packId: target.packId } : { title: title || "My training", trainer, source: sourceText },
    );
    // Rules not kept are dropped from suggestions too.
    for (const r of queue) if (!list.some((k) => k.id === r.id)) actions.dismissRule(r.id);
    setOutcome(res);
    setStage("done");
    buzz.good();
  };

  if (stage === "target") {
    return (
      <Screen footer={<Btn kind="primary" icon="play" label={`Check ${queue.length} step${queue.length > 1 ? "s" : ""}`} onPress={() => setStage("check")} />}>
        <TopBar onBack={() => router.back()} close title="Work steps" />
        <Txt v="h2">Where do these go?</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="New training" on={target.kind === "new"} onPress={() => setTarget({ kind: "new" })} />
          {state.packs.map((p) => (
            <Chip key={p.id} label={p.title} on={target.kind === "pack" && target.packId === p.id} onPress={() => setTarget({ kind: "pack", packId: p.id })} />
          ))}
        </View>
        {target.kind === "new" ? (
          <View style={{ gap: 6 }}>
            <TextInput value={title} onChangeText={setTitle} placeholder="Name, e.g. Front desk" placeholderTextColor={colors.pencil} style={field} accessibilityLabel="Training name" />
            <TextInput value={trainer} onChangeText={setTrainer} placeholder="Who taught you? (optional)" placeholderTextColor={colors.pencil} style={field} accessibilityLabel="Trainer" />
          </View>
        ) : (
          <Sketch seed="update-note" dashed fill={colors.wash} style={{ padding: 14 }}>
            <Txt v="small">If a step changes an existing rule, you'll get a Change Drill: old vs. new, then practice with the new way.</Txt>
          </Sketch>
        )}
      </Screen>
    );
  }

  if (stage === "done") {
    return (
      <Screen
        footer={
          outcome ? (
            <>
              <Btn kind="primary" icon="play" label={outcome.updates ? "See what changed" : "Practise now"} onPress={() => router.replace(`/session/${outcome.packId}?mode=${outcome.updates ? "change" : "learn"}`)} />
              <Btn kind="quiet" label="Later" onPress={() => router.back()} />
            </>
          ) : (
            <Btn kind="primary" label="Back" onPress={() => router.back()} />
          )
        }
      >
        <View style={{ alignItems: "center", gap: 10, paddingTop: 50 }}>
          <Icon name="check" size={56} strokeWidth={2.6} />
          <Txt v="hero" center>
            {outcome ? "Saved." : "Nothing kept."}
          </Txt>
          {outcome && (
            <Txt dim center>
              {outcome.added} new step{outcome.added === 1 ? "" : "s"}
              {outcome.updates ? ` · ${outcome.updates} change${outcome.updates > 1 ? "s" : ""} to drill` : ""}
            </Txt>
          )}
        </View>
      </Screen>
    );
  }

  const r = queue[i]!;
  const advance = (keep?: SuggestedRule) => {
    const list = keep ? [...kept, keep] : kept;
    setKept(list);
    setEdit(null);
    if (i + 1 >= queue.length) save(list);
    else setI(i + 1);
  };

  return (
    <Screen
      footer={
        edit ? (
          <Btn kind="primary" icon="check" label="Save my fix" onPress={() => advance({ ...r, situation: edit.situation.trim() || r.situation, action: edit.action.trim() || r.action })} />
        ) : (
          <>
            <Btn kind="primary" icon="check" label="Yes, that's what was said" onPress={() => advance(r)} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Btn style={{ flex: 1 }} label="Fix it" icon="pencil" onPress={() => setEdit({ situation: r.situation, action: r.action })} />
              <Btn style={{ flex: 1 }} label="Not a rule" onPress={() => advance()} />
            </View>
          </>
        )
      }
    >
      <TopBar onBack={() => router.back()} close title="Is this right?" right={<Dots total={queue.length} done={i} current={i} />} />
      <Sketch seed={r.id} shadow style={{ padding: 20, gap: 14 }}>
        <Label>When</Label>
        {edit ? (
          <TextInput value={edit.situation} onChangeText={(t) => setEdit({ ...edit, situation: t })} multiline style={field} accessibilityLabel="Situation" />
        ) : (
          <Txt v="h2">{r.situation}</Txt>
        )}
        <Label>You</Label>
        {edit ? (
          <TextInput value={edit.action} onChangeText={(t) => setEdit({ ...edit, action: t })} multiline style={field} accessibilityLabel="Action" />
        ) : (
          <Txt v="title">{r.action}</Txt>
        )}
        <Quote text={r.quote} />
      </Sketch>
      <Txt v="small" dim>
        Only confirm what was actually said. Unsure? Tap “Not a rule” and ask your trainer.
      </Txt>
    </Screen>
  );
}
