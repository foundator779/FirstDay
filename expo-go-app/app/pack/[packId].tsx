import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { packStats } from "../../src/logic/training";
import { useStore } from "../../src/store";
import { Btn, Dots, Label, Marked, Quote, Screen, Sketch, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

export default function PackScreen() {
  const { packId } = useLocalSearchParams<{ packId: string }>();
  const { state, actions } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const pack = state.packs.find((p) => p.id === packId);
  if (!pack) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <Txt>This training was deleted.</Txt>
      </Screen>
    );
  }
  const st = packStats(pack, state.progress, Date.now());
  const mode = st.seen < st.total ? "learn" : "review";

  return (
    <Screen
      footer={
        <>
          {pack.pendingUpdates.length > 0 && st.seen === st.total && (
            <Btn kind="primary" icon="refresh" label="See what changed" onPress={() => router.push(`/session/${pack.id}?mode=change`)} />
          )}
          <Btn kind={pack.pendingUpdates.length > 0 && st.seen === st.total ? "plain" : "primary"} icon="play" label={mode === "learn" ? "Learn" : "Practise"} onPress={() => router.push(`/session/${pack.id}?mode=${mode}`)} />
        </>
      }
    >
      <TopBar onBack={() => router.back()} />
      <Txt v="title">{pack.title}</Txt>
      <Txt dim>
        From {pack.trainer}
        {pack.sample ? " · fictional sample" : ""}
      </Txt>
      <Dots total={st.total} done={st.seen} />
      <Txt v="small" dim>
        {st.seen}/{st.total} learned · {st.solid} solid{st.due ? ` · ${st.due} due now` : ""}
      </Txt>

      <Label line>Steps</Label>
      {pack.rules.map((r) => {
        const level = state.progress[r.id]?.level ?? 0;
        return (
          <Pressable key={r.id} accessibilityRole="button" accessibilityHint="Shows the source quote" onPress={() => setOpen(open === r.id ? null : r.id)}>
            <Sketch seed={r.id} style={{ padding: 14, gap: 6 }}>
              <Txt v="small" dim>
                {r.situation}
              </Txt>
              <Marked text={r.action} keywords={r.keywords} />
              <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                {[1, 2, 3, 4].map((n) => (
                  <View key={n} style={{ width: 18, height: 5, borderRadius: 3, backgroundColor: n <= level ? colors.ink : colors.faint }} />
                ))}
                <Txt v="tiny" dim>
                  {"  "}
                  {r.changedFrom ? "updated" : ""}
                </Txt>
              </View>
              {open === r.id && <Quote who={pack.trainer} text={r.quote} />}
            </Sketch>
          </Pressable>
        );
      })}

      {pack.questions.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>Ask your trainer</Label>
          {pack.questions.map((q) => (
            <Sketch key={q} seed={q} dashed fill={colors.wash} style={{ padding: 12, gap: 6 }}>
              <Txt v="small">{q}</Txt>
              <Btn kind="quiet" align="left" label="Add to my to-dos" onPress={() => actions.addTodo(`Ask ${pack.trainer}: ${q}`, "later")} />
            </Sketch>
          ))}
        </View>
      )}

      <Btn kind="quiet" align="left" label={showSource ? "Hide the source conversation" : "Show the source conversation"} onPress={() => setShowSource(!showSource)} />
      {showSource && (
        <Sketch seed="src" style={{ padding: 14 }}>
          <Txt v="small">{pack.source || "No source text saved."}</Txt>
        </Sketch>
      )}

      <View style={{ flexDirection: "row", gap: 16 }}>
        <Btn kind="quiet" icon="refresh" label="Start over" onPress={() => actions.resetPack(pack.id)} />
        <Btn
          kind="quiet"
          icon="trash"
          label="Delete"
          onPress={() =>
            Alert.alert("Delete this training?", "Its practice history goes too.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => { actions.deletePack(pack.id); router.back(); } },
            ])
          }
        />
      </View>
    </Screen>
  );
}
