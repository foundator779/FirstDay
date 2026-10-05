import { router } from "expo-router";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { friendlyDue, parseDue } from "../../src/logic/dates";
import type { Todo } from "../../src/logic/types";
import { useStore } from "../../src/store";
import { Icon } from "../../src/ui/icons";
import { Btn, CheckBox, Chip, Empty, Screen, Sketch, TopBar, Txt, useUI } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

const BUCKETS: { key: Todo["bucket"]; label: string }[] = [
  { key: "now", label: "Now" },
  { key: "later", label: "Later" },
  { key: "done", label: "Done" },
];

export default function Todos() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const [bucket, setBucket] = useState<Todo["bucket"]>("now");
  const [draft, setDraft] = useState("");
  const now = Date.now();
  const suggested = state.todos.filter((t) => t.suggested).length;
  const list = state.todos
    .filter((t) => !t.suggested && t.bucket === bucket)
    .sort((a, b) => (bucket === "done" ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : (a.due ?? Infinity) - (b.due ?? Infinity)));

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    actions.addTodo(text, bucket === "done" ? "now" : bucket, parseDue(text, Date.now()));
    setDraft("");
  };

  return (
    <Screen>
      <TopBar title="Do" />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {BUCKETS.map((b) => (
          <Chip key={b.key} label={b.label} on={bucket === b.key} onPress={() => setBucket(b.key)} />
        ))}
      </View>

      {bucket !== "done" && (
        <Sketch seed="add-todo" style={{ flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 6, minHeight: 56 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            placeholder={bucket === "now" ? "Add something for now…" : "Add something for later…"}
            placeholderTextColor={colors.pencil}
            returnKeyType="done"
            accessibilityLabel="New to-do"
            style={{ flex: 1, fontFamily: fonts.body, fontSize: s.body, color: colors.ink, paddingVertical: 10 }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={add} hitSlop={8} style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
            <Icon name="plus" size={22} color={colors.onHighlight} strokeWidth={2.4} />
          </Pressable>
        </Sketch>
      )}
      {bucket !== "done" && <Txt v="tiny" dim>Tip: say “tomorrow at 3” and I'll nudge you then.</Txt>}

      {suggested > 0 && (
        <Btn label={`${suggested} suggested from conversations`} icon="bulb" small onPress={() => router.push("/sort")} />
      )}

      {bucket === "now" && list.length > 3 && (
        <Sketch seed="too-many" dashed fill={colors.highlightSoft} style={{ padding: 14 }}>
          <Txt v="small">Now has {list.length} things. Brains like 3. Tap one and move it to Later?</Txt>
        </Sketch>
      )}

      {list.length === 0 ? (
        <Empty icon={bucket === "done" ? "star" : "check"} text={bucket === "now" ? "Nothing for now. Enjoy it." : bucket === "later" ? "Later is empty." : "Finished things show up here."} />
      ) : (
        list.map((t) => {
          const done = t.bucket === "done";
          return (
            <Sketch key={t.id} seed={t.id} fill={done ? colors.ink : colors.card} radius={18} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 }}>
              <CheckBox label={t.text} on={done} onPress={() => actions.moveTodo(t.id, done ? "now" : "done")} />
              <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityHint="Opens focus view" onPress={() => router.push(`/focus/${t.id}`)}>
                <Txt dim={done} style={done ? { textDecorationLine: "line-through" } : undefined}>{t.text}</Txt>
                {(t.due || t.steps.length > 0) && (
                  <Txt v="small" dim>
                    {[t.due && !done ? friendlyDue(t.due, now) : "", t.steps.length ? `${t.steps.filter((x) => x.done).length}/${t.steps.length} tiny steps` : ""].filter(Boolean).join(" · ")}
                  </Txt>
                )}
              </Pressable>
              {!done && <Icon name="chevron" size={18} color={colors.pencil} />}
            </Sketch>
          );
        })
      )}
    </Screen>
  );
}
