import { Redirect, router } from "expo-router";
import { Pressable, View } from "react-native";
import { beeCloudAvailable } from "../../src/beeCloud";
import { coachAvailable } from "../../src/coachCloud";
import { nextThings, readiness, type NextThing } from "../../src/logic/today";
import { useStore } from "../../src/store";
import { Icon } from "../../src/ui/icons";
import { Btn, Dots, IconBtn, Label, Screen, Sketch, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

const go = (n: NextThing) =>
  router.push(n.params ? `${n.href}?${Object.entries(n.params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : n.href);

/** Today has one job: getting you ready for your next shift. One next thing, then at most three more. */
export default function Today() {
  const { state, actions } = useStore();
  const now = Date.now();
  const options = nextThings(state, now);
  const ready = readiness(state, now);
  const main = options[0];
  const also = options.slice(1, 4);

  if (!state.onboarded) return <Redirect href="/welcome" />;

  return (
    <Screen>
      <TopBar
        title="Today"
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
          <Btn kind="primary" label={main.cta} icon="play" onPress={() => go(main)} />
          {main.beeId && <Btn kind="quiet" label="Not now" onPress={() => actions.dismissBeeInbox([main.beeId!])} />}
        </Sketch>
      ) : (
        <Sketch seed="clear" shadow radius={24} style={{ padding: 22, gap: 8, alignItems: "center" }}>
          <Icon name="star" size={40} />
          <Txt v="hero" center>
            {state.packs.length ? "Ready for your shift." : "Get ready for day one."}
          </Txt>
          <Txt dim center>
            {state.packs.length
              ? "Everything's practised and nothing has changed. Take a breath."
              : "Wear your Bee while your trainer shows you around, or paste what they said. I'll turn each step into practice, in their words."}
          </Txt>
          {!state.packs.length && (
            <View style={{ alignSelf: "stretch", gap: 8, paddingTop: 6 }}>
              {beeCloudAvailable && !state.brain?.bee && <Btn kind="primary" icon="bee" label="Connect my Bee" onPress={() => router.push("/bee-connect")} />}
              <Btn kind={beeCloudAvailable && !state.brain?.bee ? "plain" : "primary"} icon="plus" label="Make a training" onPress={() => router.push("/capture")} />
              {coachAvailable && <Btn icon="link" label="Join my team's training" onPress={() => router.push("/join")} />}
            </View>
          )}
        </Sketch>
      )}

      {also.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>Also waiting (no rush)</Label>
          {also.map((o) => (
            <Pressable key={o.kind} accessibilityRole="button" accessibilityLabel={`${o.kicker}: ${o.title}`} onPress={() => go(o)}>
              <Sketch seed={o.kind} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
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

      {ready.total > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>Before your next shift</Label>
          <Sketch seed="ready" fill={colors.wash} style={{ padding: 16, gap: 10 }}>
            <Dots total={ready.total} done={ready.solid} />
            <Txt>
              <Txt bold>{ready.solid}</Txt> of {ready.total} steps solid · {ready.learned - ready.solid > 0 ? `${ready.learned - ready.solid} getting there · ` : ""}
              {ready.total - ready.learned > 0 ? `${ready.total - ready.learned} not tried yet` : "all tried"}
            </Txt>
            {(ready.due > 0 || ready.changed > 0 || ready.questions > 0) && (
              <Txt v="small" dim>
                {[ready.due && `${ready.due} due for a quick review`, ready.changed && `${ready.changed} changed by your trainer`, ready.questions && `${ready.questions} question${ready.questions > 1 ? "s" : ""} to ask`]
                  .filter(Boolean)
                  .join(" · ")}
              </Txt>
            )}
          </Sketch>
        </View>
      )}
    </Screen>
  );
}
