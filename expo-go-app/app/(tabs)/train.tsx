import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { dayKey } from "../../src/logic/text";
import { nextTraining, packStats } from "../../src/logic/training";
import { useStore } from "../../src/store";
import { Face, CAST } from "../../src/ui/faces";
import { Icon } from "../../src/ui/icons";
import { Btn, Dots, Label, Screen, Sketch, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

export default function Train() {
  const { state } = useStore();
  const now = Date.now();
  const next = nextTraining(state, now);
  const nextPack = next.kind !== "done" ? state.packs.find((p) => p.id === next.packId) : undefined;
  const todayCount = state.today.date === dayKey(now) ? state.today.count : 0;

  return (
    <Screen>
      <Txt v="title">Train</Txt>
      <Txt dim>Practise your next shift before it happens, using what your trainer actually said.</Txt>

      {next.kind !== "done" && nextPack ? (
        <Sketch seed="train-next" shadow style={{ padding: 20, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Face who={CAST[0]!} size={58} />
            <View style={{ flex: 1 }}>
              <Txt v="tiny" dim bold>
                {next.kind === "change" ? "SOMETHING CHANGED" : next.kind === "resume" ? "PICK UP WHERE YOU LEFT OFF" : next.kind === "review" ? "QUICK REVIEW" : "NEXT UP"}
              </Txt>
              <Txt v="h2">{nextPack.title}</Txt>
            </View>
          </View>
          <Txt dim>
            {next.kind === "change"
              ? `${nextPack.trainer} updated ${next.count} rule${next.count > 1 ? "s" : ""}. See old vs new, then practise the new way.`
              : next.kind === "resume"
                ? `${next.left} card${next.left > 1 ? "s" : ""} left.`
                : `${next.count} card${next.count > 1 ? "s" : ""}. One situation at a time.`}
          </Txt>
          <Btn
            kind="primary"
            icon="play"
            label={next.kind === "change" ? "See what changed" : "Start"}
            onPress={() => router.push(`/session/${next.packId}?mode=${next.kind === "resume" ? next.mode : next.kind}`)}
          />
        </Sketch>
      ) : (
        <Sketch seed="train-done" style={{ padding: 20, alignItems: "center", gap: 6 }}>
          <Icon name="star" size={40} />
          <Txt v="h2" center>
            All practised. Nothing due.
          </Txt>
        </Sketch>
      )}

      {todayCount > 0 && <Txt v="small" dim>Practised today: {todayCount}. Every one counts.</Txt>}

      {state.suggestedRules.length > 0 && (
        <Btn icon="bulb" label={`Check ${state.suggestedRules.length} new work step${state.suggestedRules.length > 1 ? "s" : ""}`} onPress={() => router.push("/confirm")} />
      )}

      <Label>Your trainings</Label>
      {state.packs.map((p) => {
        const st = packStats(p, state.progress, now);
        return (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.title}, ${st.seen} of ${st.total} learned`} onPress={() => router.push(`/pack/${p.id}`)}>
            <Sketch seed={p.id} style={{ padding: 16, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Txt v="h2" style={{ flex: 1 }} numberOfLines={1}>
                  {p.title}
                </Txt>
                {p.sample && (
                  <View style={{ borderWidth: 1.5, borderColor: colors.pencil, borderRadius: 10, paddingHorizontal: 8 }}>
                    <Txt v="tiny" dim>
                      Sample
                    </Txt>
                  </View>
                )}
                <Icon name="chevron" size={20} color={colors.pencil} />
              </View>
              <Dots total={st.total} done={st.seen} />
              <Txt v="small" dim>
                {st.seen}/{st.total} learned{st.due ? ` · ${st.due} due` : ""}{p.pendingUpdates.length ? ` · ${p.pendingUpdates.length} changed` : ""} · from {p.trainer}
              </Txt>
            </Sketch>
          </Pressable>
        );
      })}

      <Btn kind="quiet" icon="plus" label="Make a training from a conversation" onPress={() => router.push("/capture?mode=paste")} />
    </Screen>
  );
}
