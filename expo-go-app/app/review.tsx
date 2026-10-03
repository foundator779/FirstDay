import { router } from "expo-router";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { buzz } from "../src/device";
import { isSameDay } from "../src/logic/dates";
import type { Conversation, Memory, Todo } from "../src/logic/types";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, Dots, Label, Quote, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Kind = "convo" | "todo" | "memory";
type Item = { kind: Kind; id: string };

/**
 * FirstDay's evening review: a short pass over what was captured today.
 * Confirm, fix or remove each item. The original quote stays visible; every action can be undone.
 */
export default function Review() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const now = Date.now();
  const queue = useMemo<Item[]>(
    () => [
      ...state.conversations.filter((c) => isSameDay(c.at, now) && !c.reviewed).map((c) => ({ kind: "convo" as const, id: c.id })),
      ...state.todos.filter((t) => isSameDay(t.createdAt, now) && !t.suggested && !t.reviewed && t.fromId).map((t) => ({ kind: "todo" as const, id: t.id })),
      ...state.memories.filter((m) => isSameDay(m.at, now) && !m.suggested && !m.reviewed && m.fromId).map((m) => ({ kind: "memory" as const, id: m.id })),
    ],
    [],
  );
  const [i, setI] = useState(0);
  const [edit, setEdit] = useState<string | null>(null);
  const [last, setLast] = useState<{ kind: Kind; before: Todo | Memory | Conversation; index: number } | null>(null);

  const item = queue[i];
  const find = (it: Item): Todo | Memory | Conversation | undefined =>
    it.kind === "convo" ? state.conversations.find((c) => c.id === it.id) : it.kind === "todo" ? state.todos.find((t) => t.id === it.id) : state.memories.find((m) => m.id === it.id);
  const current = item ? find(item) : undefined;

  const go = () => {
    setEdit(null);
    setI(i + 1);
  };

  if (!item || !current) {
    if (item && !current) {
      // Deleted elsewhere; skip it.
      setTimeout(go, 0);
      return null;
    }
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <View style={{ alignItems: "center", gap: 10, paddingTop: 70 }}>
          <Icon name="moon" size={60} />
          <Txt v="hero" center>
            {queue.length ? "Day reviewed." : "Nothing to review."}
          </Txt>
          <Txt dim center>
            {queue.length ? "Everything from today is checked. Rest well." : "When you capture things today, they'll show up here tonight."}
          </Txt>
        </View>
      </Screen>
    );
  }

  const isConvo = item.kind === "convo";
  const convo = isConvo ? (current as Conversation) : undefined;
  const claim = convo ? convo.summary.join("\n") : (current as Todo | Memory).text;
  const quote = convo ? undefined : (current as Todo | Memory).quote;
  const source = state.conversations.find((c) => c.id === (convo ? convo.id : (current as Todo | Memory).fromId));

  const snapshot = () => setLast({ kind: item.kind, before: current, index: i });
  const right = () => {
    snapshot();
    actions.markReviewed(item.kind, item.id);
    buzz.good();
    go();
  };
  const remove = () => {
    snapshot();
    if (item.kind === "todo") actions.deleteTodo(item.id);
    else if (item.kind === "memory") actions.deleteMemory(item.id);
    else actions.markReviewed("convo", item.id);
    go();
  };
  const saveFix = () => {
    if (edit === null) return;
    snapshot();
    const t = edit.trim();
    if (item.kind === "convo") actions.editConversation(item.id, { summary: t.split("\n").map((x) => x.replace(/^•\s*/, "").trim()).filter(Boolean).slice(0, 3) });
    else if (item.kind === "todo") actions.editTodo(item.id, t);
    else actions.editMemory(item.id, t);
    go();
  };

  return (
    <Screen
      footer={
        edit !== null ? (
          <Btn kind="primary" icon="check" label="Save the fix" onPress={saveFix} />
        ) : (
          <>
            <Btn kind="primary" icon="check" label="That's right" onPress={right} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Btn style={{ flex: 1 }} icon="pencil" label="Fix it" onPress={() => setEdit(claim)} />
              {!isConvo && <Btn style={{ flex: 1 }} label="Remove" onPress={remove} />}
            </View>
          </>
        )
      }
    >
      <TopBar onBack={() => router.back()} close title="Evening review" right={<Dots total={Math.min(queue.length, 12)} done={Math.min(i, 12)} current={i} />} />
      <Txt v="small" dim>
        {i + 1} of {queue.length} · about {Math.max(1, Math.round(queue.length * 0.2))} min
      </Txt>
      <Sketch seed={`rv${item.id}`} shadow style={{ padding: 20, gap: 12 }}>
        <Label>{isConvo ? "I summed up" : item.kind === "todo" ? "I made a to-do" : "I remembered"}</Label>
        {edit !== null ? (
          <TextInput
            value={edit}
            onChangeText={setEdit}
            multiline
            autoFocus
            accessibilityLabel="Correction"
            style={{ fontFamily: fonts.body, fontSize: s.h2, color: colors.ink, minHeight: 80, borderBottomWidth: 2, borderBottomColor: colors.highlight, textAlignVertical: "top" }}
          />
        ) : isConvo ? (
          convo!.summary.map((l, k) => (
            <Txt key={k} v="body">
              • {l}
            </Txt>
          ))
        ) : (
          <Txt v="title">{claim}</Txt>
        )}
        {quote && <Quote text={quote} />}
        {source && (
          <Txt v="small" dim>
            From: {source.title}
          </Txt>
        )}
      </Sketch>
      {last && (
        <Btn
          kind="quiet"
          icon="undo"
          label="Undo last"
          onPress={() => {
            actions.restore(last.kind, last.before);
            setI(last.index);
            setLast(null);
          }}
        />
      )}
    </Screen>
  );
}
