import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { buzz } from "../../src/device";
import { friendlyDue, parseDue } from "../../src/logic/dates";
import { useStore } from "../../src/store";
import { Icon } from "../../src/ui/icons";
import { Btn, CheckBox, Chip, Label, Quote, Screen, Sketch, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

/** "Just this one": a single task, a timer, and tiny steps. Nothing else on screen. */
export default function Focus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const todo = state.todos.find((t) => t.id === id);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tinyBusy, setTinyBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  const left = endsAt ? Math.max(0, endsAt - now) : 0;
  useEffect(() => {
    if (endsAt && left === 0) buzz.good();
  }, [left === 0]);

  if (celebrate) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <View style={{ alignItems: "center", gap: 12, paddingTop: 80 }}>
          <Icon name="star" size={72} />
          <Txt v="hero" center>
            Done. That counts.
          </Txt>
          <Txt dim center>
            Take a breath before the next thing.
          </Txt>
        </View>
      </Screen>
    );
  }
  if (!todo) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <Txt>That to-do is gone.</Txt>
      </Screen>
    );
  }

  const from = state.conversations.find((c) => c.id === todo.fromId);
  const nextStep = todo.steps.find((x) => !x.done);
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <Screen
      footer={
        <>
          <Btn
            kind="primary"
            icon="check"
            label="Done!"
            onPress={() => {
              actions.moveTodo(todo.id, "done");
              buzz.good();
              setCelebrate(true);
            }}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Btn style={{ flex: 1 }} small label={todo.bucket === "later" ? "Move to Now" : "Not now"} onPress={() => { actions.moveTodo(todo.id, todo.bucket === "later" ? "now" : "later"); router.back(); }} />
            <Btn style={{ flex: 1 }} small label="Options" onPress={() => setMore(!more)} />
          </View>
        </>
      }
    >
      <TopBar onBack={() => router.back()} title="Just this one" />
      <Sketch seed={todo.id} shadow style={{ padding: 22, gap: 12 }}>
        <Txt v="hero">{todo.text}</Txt>
        {todo.due && <Txt dim>⏰ {friendlyDue(todo.due, Date.now())}</Txt>}
        {nextStep && (
          <Sketch seed="next-step" fill={colors.highlightSoft} style={{ padding: 12 }}>
            <Txt v="tiny" dim bold>
              NEXT TINY STEP
            </Txt>
            <Txt v="h2">{nextStep.text}</Txt>
          </Sketch>
        )}
      </Sketch>

      <Label>Timer</Label>
      {endsAt ? (
        <Sketch seed="timer" style={{ padding: 16, alignItems: "center", gap: 6 }}>
          <Txt v="hero" style={{ fontSize: 56, lineHeight: 64 }}>
            {left === 0 ? "Time!" : `${mm}:${String(ss).padStart(2, "0")}`}
          </Txt>
          <View style={{ height: 6, alignSelf: "stretch", backgroundColor: colors.faint, borderRadius: 3, overflow: "hidden" }}>
            <View style={{ height: 6, width: `${minutes ? 100 - (left / (minutes * 60000)) * 100 : 0}%`, backgroundColor: colors.ink }} />
          </View>
          <Btn kind="quiet" label={left === 0 ? "Reset" : "Stop timer"} onPress={() => { setEndsAt(null); setMinutes(null); }} />
        </Sketch>
      ) : (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {[2, 5, 10, 15, 25].map((m) => (
            <Chip key={m} label={`${m} min`} on={false} onPress={() => { setMinutes(m); setEndsAt(Date.now() + m * 60000); setNow(Date.now()); }} />
          ))}
        </View>
      )}

      <Label>Tiny steps</Label>
      {todo.steps.length === 0 ? (
        tinyBusy ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Btn icon="split" label="Make it tiny" hint="Breaks this into small first steps" onPress={async () => { setTinyBusy(true); await actions.makeTiny(todo.id); setTinyBusy(false); }} />
        )
      ) : (
        todo.steps.map((st) => (
          <View key={st.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <CheckBox label={st.text} on={st.done} onPress={() => actions.toggleStep(todo.id, st.id)} />
            <Txt style={{ flex: 1, ...(st.done ? { textDecorationLine: "line-through", color: colors.pencil } : {}) }}>{st.text}</Txt>
          </View>
        ))
      )}

      {more && (
        <Sketch seed="opts" fill={colors.wash} style={{ padding: 16, gap: 10 }}>
          <Label>Remind me</Label>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {["in 1 hour", "tonight", "tomorrow at 9am", "monday at 9am"].map((p) => (
              <Chip key={p} label={p} on={false} onPress={() => actions.setDue(todo.id, parseDue(p, Date.now()))} />
            ))}
            {todo.due && <Chip label="No reminder" on={false} onPress={() => actions.setDue(todo.id, undefined)} />}
          </View>
          <Btn kind="quiet" icon="trash" align="left" label="Delete this to-do" onPress={() => { actions.deleteTodo(todo.id); router.back(); }} />
        </Sketch>
      )}

      {todo.quote && (
        <View style={{ gap: 6 }}>
          <Quote text={todo.quote} />
          {from && (
            <Btn kind="quiet" align="left" label={`Open “${from.title}”`} onPress={() => router.push(`/convo/${from.id}`)} />
          )}
        </View>
      )}
    </Screen>
  );
}
