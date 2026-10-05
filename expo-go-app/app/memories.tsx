import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import type { Memory } from "../src/logic/types";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, Chip, Empty, Label, Quote, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

const KINDS: { key: Memory["kind"]; label: string }[] = [
  { key: "me", label: "About you" },
  { key: "people", label: "People" },
  { key: "work", label: "Work" },
  { key: "other", label: "Other" },
];

export default function Memories() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<Memory["kind"]>("me");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const kept = state.memories.filter((m) => !m.suggested);
  const suggested = state.memories.length - kept.length;
  const beeLinked = !!state.brain?.bee && state.settings.syncToBee;

  const forget = (m: Memory) => {
    if (!m.beeFactId || !beeLinked) return actions.deleteMemory(m.id);
    Alert.alert("Forget this?", "It also lives in your Bee.", [
      { text: "Cancel", style: "cancel" },
      { text: "Only here", onPress: () => actions.deleteMemory(m.id, false) },
      { text: "Here and in Bee", style: "destructive", onPress: () => actions.deleteMemory(m.id, true) },
    ]);
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="What I remember" />
      <Txt dim>Facts from your conversations. Fix or forget anything, any time.</Txt>
      {suggested > 0 && <Btn small icon="bulb" label={`${suggested} new to check`} onPress={() => router.push("/sort")} />}

      <Sketch seed="add-mem" style={{ padding: 12, gap: 10 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Tell me something to remember…"
          placeholderTextColor={colors.pencil}
          accessibilityLabel="New memory"
          style={{ fontFamily: fonts.body, fontSize: s.body, color: colors.ink, paddingVertical: 6 }}
        />
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {KINDS.map((k) => (
            <Chip key={k.key} label={k.label} on={kind === k.key} onPress={() => setKind(k.key)} />
          ))}
        </View>
        <Btn small icon="plus" label="Remember" disabled={!draft.trim()} onPress={() => { actions.addMemory(draft, kind); setDraft(""); }} />
      </Sketch>

      {kept.length === 0 && <Empty icon="brain" text="Nothing yet. Memories come from your conversations." />}
      {KINDS.map((k) => {
        const list = kept.filter((m) => m.kind === k.key);
        if (!list.length) return null;
        return (
          <View key={k.key} style={{ gap: 8 }}>
            <Label line>{k.label}</Label>
            {list.map((m) => (
              <Pressable key={m.id} accessibilityRole="button" accessibilityHint="Shows options" onPress={() => { setOpen(open === m.id ? null : m.id); setEdit(null); }}>
                <Sketch seed={m.id} style={{ padding: 14, gap: 10 }}>
                  {edit !== null && open === m.id ? (
                    <TextInput value={edit} onChangeText={setEdit} multiline autoFocus accessibilityLabel="Edit memory" style={{ fontFamily: fonts.body, fontSize: s.body, color: colors.ink }} />
                  ) : (
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                      <Txt style={{ flex: 1 }}>{m.text}</Txt>
                      {m.beeFactId && <Icon name="bee" size={18} color={colors.pencil} />}
                    </View>
                  )}
                  {open === m.id && (
                    <View style={{ gap: 8 }}>
                      {m.quote && <Quote text={m.quote} />}
                      {m.previousText && <Txt v="small" dim>Was: {m.previousText}</Txt>}
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {edit !== null ? (
                          <Btn small style={{ flex: 1 }} icon="check" label="Save" onPress={() => { if (edit.trim()) actions.editMemory(m.id, edit.trim()); setEdit(null); }} />
                        ) : (
                          <Btn small style={{ flex: 1 }} icon="pencil" label="Fix" onPress={() => setEdit(m.text)} />
                        )}
                        <Btn small style={{ flex: 1 }} icon="trash" label="Forget" onPress={() => forget(m)} />
                      </View>
                    </View>
                  )}
                </Sketch>
              </Pressable>
            ))}
          </View>
        );
      })}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10 }}>
        <Icon name="brain" size={20} color={colors.pencil} />
        <Txt v="small" dim style={{ flex: 1 }}>
          {beeLinked ? "Stored on this phone. Ones with a bee are shared with your Bee; fixes go back to it." : "Stored only on this phone."}
        </Txt>
      </View>
    </Screen>
  );
}
