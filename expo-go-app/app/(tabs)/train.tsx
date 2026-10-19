import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { coachAvailable } from "../../src/coachCloud";
import { dayKey } from "../../src/logic/text";
import { nextTraining, packStats } from "../../src/logic/training";
import { useStore } from "../../src/store";
import { Face, CAST } from "../../src/ui/faces";
import { Icon } from "../../src/ui/icons";
import { Btn, Dots, Label, Screen, Sketch, Stat, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

export default function Train() {
  const { state, actions } = useStore();
  const now = Date.now();
  const next = nextTraining(state, now);
  const nextPack = next.kind !== "done" ? state.packs.find((p) => p.id === next.packId) : undefined;
  const todayCount = state.today.date === dayKey(now) ? state.today.count : 0;
  const totals = state.packs.reduce(
    (a, p) => {
      const st = packStats(p, state.progress, now);
      return { seen: a.seen + st.seen, total: a.total + st.total, due: a.due + st.due };
    },
    { seen: 0, total: 0, due: 0 },
  );

  return (
    <Screen>
      <TopBar title="Train" />
      <Txt dim center>Practise your next shift before it happens, using what your trainer actually said.</Txt>

      {state.packs.length > 0 && (
        <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
          <Stat value={todayCount} label="Today" />
          <Stat value={`${totals.seen}/${totals.total}`} label="Learned" />
          <Stat value={totals.due} label="Due" />
        </View>
      )}

      {next.kind !== "done" && nextPack ? (
        <Sketch seed="train-next" fill={colors.ink} radius={24} style={{ padding: 20, gap: 12 }}>
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
      ) : state.packs.length === 0 ? (
        <Sketch seed="train-empty" shadow radius={24} style={{ padding: 20, gap: 12 }}>
          <Txt v="h2">No trainings yet</Txt>
          <Txt dim>When a trainer or manager explains how things work, capture it. I'll find each step with their exact words and turn it into practice.</Txt>
          <Btn kind="primary" icon="plus" label="Make a training from a conversation" onPress={() => router.push("/capture")} />
          {coachAvailable && <Btn icon="link" label="Join my team's training" onPress={() => router.push("/join")} />}
          <Btn kind="quiet" label="Try a sample training" onPress={actions.addSampleTrainings} />
        </Sketch>
      ) : (
        <Sketch seed="train-done" style={{ padding: 20, alignItems: "center", gap: 6 }}>
          <Icon name="star" size={40} />
          <Txt v="h2" center>
            All practised. Nothing due.
          </Txt>
        </Sketch>
      )}

      {state.suggestedRules.length > 0 && (
        <Btn icon="bulb" label={`Check ${state.suggestedRules.length} new work step${state.suggestedRules.length > 1 ? "s" : ""}`} onPress={() => router.push("/confirm")} />
      )}

      {state.teamRequests.map((r) => (
        <Sketch key={r.code} seed={`req-${r.code}`} dashed fill={colors.wash} style={{ padding: 16, gap: 8 }}>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1 }}>
            {r.title.toUpperCase()}
          </Txt>
          <Txt bold>{r.status === "declined" ? `${r.trainer} didn't let you in` : `Waiting for ${r.trainer} to let you in`}</Txt>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {r.status === "pending" && <Btn small style={{ flex: 1 }} icon="refresh" label="Check now" onPress={() => void actions.checkTeams()} />}
            <Btn small style={{ flex: 1 }} label={r.status === "pending" ? "Take back" : "OK"} onPress={() => void actions.cancelTeamRequest(r.code)} />
          </View>
        </Sketch>
      ))}

      {state.packs.length > 0 && <Label line>Your trainings</Label>}
      {state.packs.map((p) => {
        const st = packStats(p, state.progress, now);
        return (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.title}, ${st.seen} of ${st.total} learned`} onPress={() => router.push(`/pack/${p.id}`)}>
            <Sketch seed={p.id} style={{ padding: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Txt v="h2" style={{ flex: 1 }} numberOfLines={1}>
                  {p.title}
                </Txt>
                {(p.sample || p.team) && (
                  <View style={{ borderWidth: 1.5, borderColor: colors.pencil, borderRadius: 10, paddingHorizontal: 8 }}>
                    <Txt v="tiny" dim>
                      {p.sample ? "Sample" : p.team?.role === "trainer" ? "Shared" : "Team"}
                    </Txt>
                  </View>
                )}
                <Icon name="chevron" size={20} color={colors.pencil} />
              </View>
              <Dots total={st.total} done={st.seen} />
              <Txt v="small" dim>
                {st.seen}/{st.total} learned{st.due ? ` · ${st.due} due` : ""}{p.pendingUpdates.length ? ` · ${p.pendingUpdates.length} changed` : ""}
                {p.team?.role === "trainer" ? ` · shared with ${p.team.members ?? 0} ${p.team.members === 1 ? "person" : "people"}${p.team.dirty ? " · changes to send" : ""}` : ` · from ${p.trainer}`}
              </Txt>
            </Sketch>
          </Pressable>
        );
      })}

      {state.packs.length > 0 && <Btn kind="quiet" icon="plus" label="Make a training from a conversation" onPress={() => router.push("/capture")} />}
      {state.packs.length > 0 && coachAvailable && <Btn kind="quiet" icon="link" label="Join my team's training" onPress={() => router.push("/join")} />}
    </Screen>
  );
}
