import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { coachAvailable } from "../../src/coachCloud";
import { moreCounts } from "../../src/logic/today";
import { useStore } from "../../src/store";
import { Icon, type IconName } from "../../src/ui/icons";
import { Label, Screen, Sketch, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

function Row({ icon, title, sub, href, badge }: { icon: IconName; title: string; sub: string; href: string; badge?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={badge ? `${title}, ${badge} waiting` : title} onPress={() => router.push(href)}>
      <Sketch seed={href} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name={icon} size={24} />
        <View style={{ flex: 1 }}>
          <Txt bold>{title}</Txt>
          <Txt v="small" dim>
            {sub}
          </Txt>
        </View>
        {!!badge && (
          <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
            <Txt v="tiny" bold style={{ color: colors.onHighlight }}>
              {badge > 9 ? "9+" : String(badge)}
            </Txt>
          </View>
        )}
        <Icon name="chevron" size={20} color={colors.pencil} />
      </Sketch>
    </Pressable>
  );
}

/** Everything that isn't "get ready for your next shift": team, other apps, and the everyday helpers built on Bee. */
export default function More() {
  const { state } = useStore();
  const c = moreCounts(state);
  const reviewable = state.conversations.length > 0;

  return (
    <Screen>
      <TopBar title="More" />

      {coachAvailable && (
        <>
          <Label line>Your team</Label>
          <Row icon="link" title="Join my team's training" sub="Your trainer gives you a 6-character code and lets you in. Their changes reach you as a Change Drill." href="/join" />
          <Txt v="small" dim>
            Training someone? Open your training in Train and tap “Share with my team”.
          </Txt>
          <Label line>Practise anywhere</Label>
          <Row icon="speaker" title="Quiz me from other apps" sub="A voice screen and any AI assistant (MCP) can quiz you on your confirmed steps." href="/coach-link" />
        </>
      )}

      <Label line>Everyday helpers (from your Bee)</Label>
      <Row
        icon="mic"
        title="Conversations"
        sub={state.conversations.length ? `${state.conversations.length} saved on this phone · word for word` : "What you bring in is kept here, word for word"}
        href="/conversations"
      />
      <Row icon="list" title="To-dos" sub={c.now ? `${c.now} for now · synced with Bee` : "Now, Later, Done · synced with Bee"} href="/todos" />
      {c.toSort > 0 && <Row icon="bulb" title="Sort new things" sub="To-dos and memories found in your conversations. Keep or toss." href="/sort" badge={c.toSort} />}
      <Row icon="chat" title="Ask" sub="Questions about your conversations, with sources." href="/ask" />
      <Row icon="brain" title="What I remember" sub={`${c.memories} ${c.memories === 1 ? "memory" : "memories"} · synced with Bee facts`} href="/memories" />
      {reviewable && <Row icon="moon" title="Evening review" sub="A 2-minute check of today, with undo." href="/review" />}
      {reviewable && <Row icon="refresh" title="Your patterns" sub="Mood, people and themes over 4 weeks." href="/patterns" />}

      {(state.bee.daily || state.bee.insights.length > 0) && (
        <Sketch seed="bee-day" fill={colors.wash} style={{ padding: 16, gap: 6 }}>
          <Label>From your Bee</Label>
          {state.bee.daily?.lines.map((l, i) => (
            <Txt key={`d${i}`} v="small">
              • {l}
            </Txt>
          ))}
          {state.bee.insights.map((l, i) => (
            <Txt key={`i${i}`} v="small" dim>
              Bee noticed: {l}
            </Txt>
          ))}
        </Sketch>
      )}

      <Label line>App</Label>
      <Row icon="sliders" title="Settings" sub="Account, Bee, practice and comfort." href="/settings" />
    </Screen>
  );
}
