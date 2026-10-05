import { router } from "expo-router";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { buzz } from "../src/device";
import { friendlyDue } from "../src/logic/dates";
import type { Memory, Todo } from "../src/logic/types";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, Quote, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Item = { kind: "todo"; id: string } | { kind: "memory"; id: string };

/** Keep-or-toss, one card at a time. Nothing is added until you say so. */
export default function Sort() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const queue = useMemo<Item[]>(
    () => [
      ...state.todos.filter((t) => t.suggested).map((t) => ({ kind: "todo" as const, id: t.id })),
      ...state.memories.filter((m) => m.suggested).map((m) => ({ kind: "memory" as const, id: m.id })),
    ],
    // Snapshot once so the list doesn't shift while sorting.
    [],
  );
  const [i, setI] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [last, setLast] = useState<{ kind: Item["kind"]; before: Todo | Memory; index: number } | null>(null);
  const now = Date.now();

  const exists = (it: Item) => (it.kind === "todo" ? state.todos.some((t) => t.id === it.id) : state.memories.some((m) => m.id === it.id));
  let k = i;
  while (k < queue.length && !exists(queue[k]!)) k++;
  const item = queue[k];
  const todo = item?.kind === "todo" ? state.todos.find((t) => t.id === item.id) : undefined;
  const memory = item?.kind === "memory" ? state.memories.find((m) => m.id === item.id) : undefined;
  const current = todo ?? memory;
  const from = state.conversations.find((c) => c.id === current?.fromId);

  const next = () => {
    setEditing(null);
    setI(k + 1);
  };
  const remember = () => current && setLast({ kind: item!.kind, before: current, index: k });

  if (!item || !current) {
    return (
      <Screen footer={<Btn kind="primary" label="Back to today" onPress={() => router.back()} />}>
        <View style={{ alignItems: "center", gap: 10, paddingTop: 60 }}>
          <Icon name="star" size={56} />
          <Txt v="hero" center>
            All sorted.
          </Txt>
          <Txt dim center>
            Your head just got a little lighter.
          </Txt>
        </View>
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
  const saveEdit = () => {
    if (editing === null) return;
    const t = editing.trim();
    if (t && t !== current.text) {
      if (todo) actions.editTodo(todo.id, t);
      else actions.editMemory(current.id, t);
    }
    setEditing(null);
  };

  return (
    <Screen
      footer={
        editing !== null ? (
          <Btn kind="primary" icon="check" label="Save" onPress={saveEdit} />
        ) : todo ? (
          <>
            <Btn kind="primary" icon="play" label="Do it now-ish" onPress={() => { remember(); actions.acceptTodo(todo.id, "now"); buzz.good(); next(); }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Btn style={{ flex: 1 }} label="Later" onPress={() => { remember(); actions.acceptTodo(todo.id, "later"); next(); }} />
              <Btn style={{ flex: 1 }} label="No thanks" onPress={() => { remember(); actions.deleteTodo(todo.id); next(); }} />
            </View>
          </>
        ) : (
          <>
            <Btn kind="primary" icon="check" label="Yes, remember it" onPress={() => { remember(); actions.acceptMemory(current.id); buzz.good(); next(); }} />
            <Btn label="No, forget it" onPress={() => { remember(); actions.deleteMemory(current.id); next(); }} />
          </>
        )
      }
    >
      <TopBar onBack={() => router.back()} close title="Sort" progress={{ total: Math.min(queue.length, 12), done: Math.min(k, 12), current: k }} />
      <Txt v="small" dim>
        {k + 1} of {queue.length}. You can stop any time.
      </Txt>
      <Sketch seed={current.id} shadow style={{ padding: 20, gap: 14 }}>
        <Txt v="tiny" dim bold style={{ letterSpacing: 1.2 }}>
          {todo ? "KEEP THIS TO-DO?" : "REMEMBER THIS?"}
        </Txt>
        {editing !== null ? (
          <TextInput
            value={editing}
            onChangeText={setEditing}
            autoFocus
            multiline
            accessibilityLabel="Edit text"
            style={{ fontFamily: fonts.bodyBold, fontSize: s.title, color: colors.ink, borderBottomWidth: 2, borderBottomColor: colors.ink }}
          />
        ) : (
          <Txt v="title">{current.text}</Txt>
        )}
        {todo?.due && <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="timer" size={18} color={colors.pencil} /><Txt dim>{friendlyDue(todo.due, now)}</Txt></View>}
        {current.quote && <Quote text={current.quote} />}
        {from && (
          <Txt v="small" dim>
            From: {from.title}
          </Txt>
        )}
        {editing === null && <Btn kind="quiet" icon="pencil" align="left" label="Fix the wording" onPress={() => setEditing(current.text)} />}
      </Sketch>
      {last && (
        <Btn
          kind="quiet"
          icon="undo"
          label="Undo last"
          onPress={() => {
            actions.restore(last.kind, last.before);
            setLast(null);
            setI(last.index);
          }}
        />
      )}
    </Screen>
  );
}
