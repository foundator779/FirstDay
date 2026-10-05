import { Redirect, router } from "expo-router";
import { Pressable, View } from "react-native";
import { friendlyDay, friendlyDue, isSameDay } from "../../src/logic/dates";
import { nextTraining } from "../../src/logic/training";
import { useStore } from "../../src/store";
import { Icon } from "../../src/ui/icons";
import { Btn, IconBtn, Label, Screen, Sketch, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

type Next = { kicker: string; title: string; sub: string; cta: string; go: () => void; dismiss?: () => void };

export default function Today() {
  const { state, actions } = useStore();
  const now = Date.now();
  const hour = new Date(now).getHours();

  const toSort = state.todos.filter((t) => t.suggested).length + state.memories.filter((m) => m.suggested).length;
  const rulesFound = state.suggestedRules.length;
  const nowTodos = state.todos
    .filter((t) => !t.suggested && t.bucket === "now")
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const training = nextTraining(state, now);
  const reviewCount =
    state.conversations.filter((c) => isSameDay(c.at, now) && !c.reviewed).length +
    state.todos.filter((t) => isSameDay(t.createdAt, now) && !t.suggested && !t.reviewed && t.fromId).length +
    state.memories.filter((m) => isSameDay(m.at, now) && !m.suggested && !m.reviewed && m.fromId).length;

  const options: Next[] = [];
  if (toSort) options.push({ kicker: "New from your conversations", title: `Sort ${toSort} new thing${toSort > 1 ? "s" : ""}`, sub: "Keep or toss, one at a time. About a minute.", cta: "Start sorting", go: () => router.push("/sort") });
  const first = nowTodos[0];
  if (first) options.push({ kicker: "Just this one", title: first.text, sub: first.due ? `Due ${friendlyDue(first.due, now)}` : "Nothing else. Only this.", cta: "Focus on it", go: () => router.push(`/focus/${first.id}`) });
  if (rulesFound) options.push({ kicker: "Work steps found", title: `${rulesFound} instruction${rulesFound > 1 ? "s" : ""} to check`, sub: "Confirm what your trainer said, then practise it.", cta: "Check them", go: () => router.push("/confirm") });
  if (training.kind !== "done") {
    const pack = state.packs.find((p) => p.id === training.packId);
    const label =
      training.kind === "resume" ? `Pick up where you left off · ${training.left} left`
      : training.kind === "change" ? `${pack?.trainer ?? "Your trainer"} changed ${training.count} thing${training.count > 1 ? "s" : ""}`
      : training.kind === "review" ? `${training.count} quick review${training.count > 1 ? "s" : ""}`
      : `Learn ${training.count} new step${training.count > 1 ? "s" : ""}`;
    const mode = training.kind === "resume" ? training.mode : training.kind;
    options.push({ kicker: "Work practice", title: pack?.title ?? "Practice", sub: `${label} · about ${Math.max(1, Math.round((training.kind === "resume" ? training.left : training.count) * 0.8))} min`, cta: training.kind === "change" ? "See what changed" : "Start", go: () => router.push(`/session/${training.packId}?mode=${mode}`) });
  }
  const fromBee = state.bee.inbox.find((i) => !state.conversations.some((c) => c.beeId === i.id));
  if (fromBee) {
    options.unshift({
      kicker: "Just recorded by Bee",
      title: fromBee.title,
      sub: state.bee.inbox.length > 1 ? `Turn it into practice while it's fresh? (${state.bee.inbox.length} new)` : "Turn it into practice while it's fresh?",
      cta: "Bring it in",
      go: () => router.push({ pathname: "/capture", params: { beeId: fromBee.id, beeTitle: fromBee.title, beeAt: String(fromBee.at) } }),
      dismiss: () => actions.dismissBeeInbox([fromBee.id]),
    });
  }
  if (reviewCount && hour >= 17) options.unshift({ kicker: "Evening review", title: "2-minute check of today", sub: `${reviewCount} card${reviewCount > 1 ? "s" : ""}. Fix anything I got wrong.`, cta: "Review today", go: () => router.push("/review") });

  const main = options[0];
  const also = options.slice(1, 4);
  const todays = state.conversations.filter((c) => isSameDay(c.at, now));
  const recent = state.conversations.slice(0, 5);

  if (!state.onboarded) return <Redirect href="/welcome" />;

  return (
    <Screen>
      <TopBar
        title="Today"
        left={<IconBtn name="moon" label="Evening review" onPress={() => router.push("/review")} badge={reviewCount} />}
        right={<IconBtn name="sliders" label="Settings" onPress={() => router.push("/settings")} />}
        sub={new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      />

      {main ? (
        <Sketch seed="next-up" fill={colors.ink} radius={24} style={{ padding: 22, gap: 10 }}>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1.2 }}>
            {main.kicker.toUpperCase()}
          </Txt>
          <Txt v="hero">{main.title}</Txt>
          <Txt dim style={{ marginBottom: 6 }}>{main.sub}</Txt>
          <Btn kind="primary" label={main.cta} icon="play" onPress={main.go} />
          {main.dismiss && <Btn kind="quiet" label="Not now" onPress={main.dismiss} />}
        </Sketch>
      ) : (
        <Sketch seed="clear" shadow radius={24} style={{ padding: 22, gap: 8, alignItems: "center" }}>
          <Icon name="star" size={40} />
          <Txt v="hero" center>
            All clear.
          </Txt>
          <Txt dim center>
            Nothing needs you right now. Take a breath, or tap + to capture something.
          </Txt>
        </Sketch>
      )}

      {also.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>Also waiting (no rush)</Label>
          {also.map((o) => (
            <Pressable key={o.kicker} accessibilityRole="button" accessibilityLabel={`${o.kicker}: ${o.title}`} onPress={o.go}>
              <Sketch seed={o.kicker} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Txt v="tiny" dim bold>
                    {o.kicker.toUpperCase()}
                  </Txt>
                  <Txt numberOfLines={2}>{o.title}</Txt>
                </View>
                <Icon name="chevron" size={22} color={colors.pencil} />
              </Sketch>
            </Pressable>
          ))}
        </View>
      )}

      {todays.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>Your day so far</Label>
          <Sketch seed="day" fill={colors.wash} style={{ padding: 16, gap: 6 }}>
            {todays.slice(0, 3).map((c) => (
              <Txt key={c.id}>• {c.summary[0] ?? c.title}</Txt>
            ))}
            {todays.length > 3 && <Txt v="small" dim>+ {todays.length - 3} more</Txt>}
          </Sketch>
        </View>
      )}

      {(state.bee.daily || state.bee.insights.length > 0) && (
        <View style={{ gap: 8 }}>
          <Label line>From your Bee</Label>
          <Sketch seed="bee-day" fill={colors.wash} style={{ padding: 16, gap: 6 }}>
            {state.bee.daily?.lines.map((l, i) => (
              <Txt key={`d${i}`}>• {l}</Txt>
            ))}
            {state.bee.insights.map((l, i) => (
              <Txt key={`i${i}`} v="small" dim>
                Bee noticed: {l}
              </Txt>
            ))}
          </Sketch>
        </View>
      )}

      {recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>Conversations</Label>
          {recent.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`Open ${c.title}`} onPress={() => router.push(`/convo/${c.id}`)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Icon name={c.source === "bee" ? "bee" : c.source === "note" ? "pencil" : "chat"} size={22} color={colors.pencil} />
                <View style={{ flex: 1 }}>
                  <Txt numberOfLines={1}>{c.title}</Txt>
                  <Txt v="small" dim>
                    {friendlyDay(c.at, now)}
                  </Txt>
                </View>
                <Icon name="chevron" size={20} color={colors.pencil} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
