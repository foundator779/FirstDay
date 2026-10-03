import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { say } from "../../src/device";
import { friendlyDay } from "../../src/logic/dates";
import { useStore } from "../../src/store";
import { Btn, IconBtn, Label, Screen, Sketch, TopBar, Txt, useUI } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

export default function Convo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const { s } = useUI();
  const c = state.conversations.find((x) => x.id === id);
  const [showText, setShowText] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);

  if (!c) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <Txt>That conversation was deleted.</Txt>
      </Screen>
    );
  }
  const todos = state.todos.filter((t) => t.fromId === c.id);
  const memories = state.memories.filter((m) => m.fromId === c.id);
  const rules = state.suggestedRules.filter((r) => r.fromId === c.id);
  const suggestedCount = todos.filter((t) => t.suggested).length + memories.filter((m) => m.suggested).length;

  return (
    <Screen>
      <TopBar onBack={() => router.back()} right={<IconBtn name="speaker" label="Read summary aloud" onPress={() => say(`${c.title}. ${c.summary.join(" ")}`)} />} />
      <Txt v="title">{c.title}</Txt>
      <Txt v="small" dim>
        {friendlyDay(c.at, Date.now())} · {c.source === "bee" ? "from Bee" : c.source === "note" ? "your note" : c.source === "sample" ? "sample" : "pasted"} · read {c.analyzedBy === "brain" ? "by your brain helper" : "on phone"}
      </Txt>

      <Sketch seed={`sum${c.id}`} fill={colors.wash} style={{ padding: 16, gap: 8 }}>
        <Label>In short</Label>
        {edit !== null ? (
          <>
            <TextInput
              value={edit}
              onChangeText={setEdit}
              multiline
              autoFocus
              accessibilityLabel="Summary, one point per line"
              style={{ fontFamily: fonts.body, fontSize: s.body, color: colors.ink, minHeight: 90, textAlignVertical: "top" }}
            />
            <Btn small icon="check" label="Save" onPress={() => { actions.editConversation(c.id, { summary: edit.split("\n").map((x) => x.replace(/^•\s*/, "").trim()).filter(Boolean).slice(0, 3) }); setEdit(null); }} />
          </>
        ) : (
          <>
            {c.summary.map((line, i) => (
              <Txt key={i}>• {line}</Txt>
            ))}
            <Btn kind="quiet" icon="pencil" align="left" label="Fix the summary" onPress={() => setEdit(c.summary.join("\n"))} />
          </>
        )}
      </Sketch>

      {suggestedCount > 0 && <Btn kind="primary" icon="play" label={`Sort ${suggestedCount} new thing${suggestedCount > 1 ? "s" : ""}`} onPress={() => router.push("/sort")} />}
      {rules.length > 0 && <Btn icon="cap" label={`Check ${rules.length} work step${rules.length > 1 ? "s" : ""} and practise`} onPress={() => router.push(`/confirm?from=${c.id}`)} />}

      {todos.length > 0 && (
        <View style={{ gap: 4 }}>
          <Label>To-dos</Label>
          {todos.map((t) => (
            <Txt key={t.id} style={t.bucket === "done" ? { textDecorationLine: "line-through", color: colors.pencil } : undefined}>
              {t.suggested ? "○" : "•"} {t.text}
            </Txt>
          ))}
        </View>
      )}
      {memories.length > 0 && (
        <View style={{ gap: 4 }}>
          <Label>Memories</Label>
          {memories.map((m) => (
            <Txt key={m.id}>
              {m.suggested ? "○" : "•"} {m.text}
            </Txt>
          ))}
        </View>
      )}

      <Btn kind="quiet" align="left" label={showText ? "Hide the full conversation" : "Show the full conversation"} onPress={() => setShowText(!showText)} />
      {showText && (
        <Sketch seed={`txt${c.id}`} style={{ padding: 16 }}>
          <Txt v="small">{c.text}</Txt>
        </Sketch>
      )}

      <Btn
        kind="quiet"
        icon="trash"
        align="left"
        label="Delete this conversation"
        onPress={() =>
          Alert.alert("Delete conversation?", "Unsorted suggestions from it go too. Kept to-dos and memories stay.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => { actions.deleteConversation(c.id); router.back(); } },
          ])
        }
      />
    </Screen>
  );
}
