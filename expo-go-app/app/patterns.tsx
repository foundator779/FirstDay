import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { MOOD_LABELS, patternsFor, type MoodDay, type PersonPattern } from "../src/logic/patterns";
import { friendlyDay } from "../src/logic/dates";
import { useSmartAi } from "../src/smart";
import { useStore } from "../src/store";
import { Btn, Empty, Label, Screen, Sketch, Stat, TopBar, Txt } from "../src/ui/kit";
import { MoodPicker } from "../src/ui/mood";
import { EdgeOverlay, edge } from "../src/ui/edge";
import { colors, fonts } from "../src/ui/theme";

/**
 * Patterns over time, like Bee's insights: how you've been feeling, who you've been spending time
 * with, what keeps coming up and how much you finish. Worked out on the phone; the written weekly
 * look comes from Amazon Bedrock when you're signed in (or the brain has AI).
 */
export default function Patterns() {
  const { state, actions } = useStore();
  const smart = useSmartAi();
  const now = Date.now();
  const p = useMemo(() => patternsFor(state, now), [state.conversations, state.todos, state.memories, state.moods]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const todayMood = state.moods.find((m) => m.day === p.mood.days.at(-1)?.day)?.score;

  const reflect = async () => {
    setBusy(true);
    setFailed(false);
    const r = await actions.reflect().catch(() => null);
    setFailed(!r);
    setBusy(false);
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Patterns" sub="The last 4 weeks" />

      <Sketch seed="pat-mood" style={{ padding: 16, gap: 12 }}>
        <Label>How today felt</Label>
        <MoodPicker value={todayMood} onPick={actions.logMood} />
      </Sketch>

      {!p.enough && <Empty icon="star" text="Patterns show up after a few days of captures and mood check-ins. Log how today felt to start." />}

      {/* ---------- written look (AI) ---------- */}
      {p.enough && (
        <Sketch seed="pat-ai" fill={colors.ink} radius={24} style={{ padding: 20, gap: 10 }}>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1.2 }}>
            YOUR WEEKS, IN WORDS
          </Txt>
          {state.reflection ? (
            <>
              <Txt>{state.reflection.text}</Txt>
              <Txt v="small" dim>
                Read by Amazon Bedrock · {friendlyDay(state.reflection.at, now)}
              </Txt>
            </>
          ) : (
            <Txt dim>{smart ? "Get a short written look at how you've been, who you've seen and what keeps coming up." : "Turn on smarter reading in Settings to get a short written look at your weeks."}</Txt>
          )}
          {failed && <Txt v="small" dim>Couldn't reach Amazon Bedrock. Try again in a moment.</Txt>}
          {smart &&
            (busy ? (
              <ActivityIndicator color={colors.onHighlight} />
            ) : (
              <Btn kind="primary" icon="refresh" label={state.reflection ? "Look again" : "Write my weekly look"} onPress={() => void reflect()} />
            ))}
        </Sketch>
      )}

      {/* ---------- mood ---------- */}
      {p.enough && (
        <>
          <Label line>How you've been feeling</Label>
          <Txt>{p.mood.line}</Txt>
          <MoodChart days={p.mood.days} />
          <Txt v="tiny" dim>
            Black: your check-in. Grey: read from what you said that day. Taller is a better day.
          </Txt>
        </>
      )}

      {/* ---------- people ---------- */}
      {p.people.length > 0 && (
        <>
          <Label line>Who you've been talking with</Label>
          {p.people.map((person) => (
            <PersonRow key={person.name} person={person} />
          ))}
        </>
      )}

      {/* ---------- themes ---------- */}
      {p.themes.length > 0 && (
        <>
          <Label line>Keeps coming up</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {p.themes.map((t) => (
              <View key={t.word} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, ...edge("dotted", colors.faint, 2) }}>
                <EdgeOverlay kind="dotted" color={colors.faint} width={2} radius={18} />
                <Text style={{ fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink }}>{t.word}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.pencil }}>
                  {t.weeks} of 4 weeks · {t.mentions} chats
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ---------- follow-through ---------- */}
      {p.enough && (
        <>
          <Label line>Follow-through</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Stat value={p.followThrough.added} label="Added" />
            <Stat value={p.followThrough.done} label="Done" />
            <Stat value={p.followThrough.doneBefore} label="Done last wk" />
          </View>
          <Txt dim>{p.followThrough.line}</Txt>
        </>
      )}

      {/* ---------- Bee's own insights ---------- */}
      {state.bee.insights.length > 0 && (
        <>
          <Label line>Bee noticed</Label>
          <Sketch seed="pat-bee" fill={colors.wash} style={{ padding: 16, gap: 6 }}>
            {state.bee.insights.map((l, i) => (
              <Txt key={i}>• {l}</Txt>
            ))}
          </Sketch>
        </>
      )}

      <Txt v="tiny" dim center>
        Worked out on this phone from your captures. Only the written look is sent to Amazon Bedrock, and nothing is stored there.
      </Txt>
    </Screen>
  );
}

/** 28 bars, oldest on the left. Height = mood (1–5); black for your check-ins, grey when read from conversations. */
function MoodChart({ days }: { days: MoodDay[] }) {
  const H = 88;
  return (
    <View accessibilityLabel={`Mood for the last ${days.length} days`}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: H }}>
        {days.map((d, i) => (
          <View key={d.day} style={{ flex: 1, height: H, justifyContent: "flex-end", alignItems: "center", marginLeft: i > 0 && i % 7 === 0 ? 4 : 0 }}>
            {d.score === null ? (
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.faint }} />
            ) : (
              <View
                accessibilityLabel={`${d.day}: ${MOOD_LABELS[Math.round(d.score) - 1]}`}
                style={{ alignSelf: "stretch", height: Math.max(8, (d.score / 5) * H), borderRadius: 4, backgroundColor: d.source === "check-in" ? colors.ink : "#A9A9A9" }}
              />
            )}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 6 }}>
        <Txt v="tiny" dim>4 weeks ago</Txt>
        <Txt v="tiny" dim>Today</Txt>
      </View>
    </View>
  );
}

function PersonRow({ person }: { person: PersonPattern }) {
  const max = Math.max(1, ...person.weeks);
  return (
    <Sketch seed={`p-${person.name}`} radius={18} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: person.shift === "up" ? colors.ink : colors.wash, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: person.shift === "up" ? colors.onHighlight : colors.ink }}>{person.name.slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold>{person.name}</Txt>
        <Txt v="small" dim>
          {person.line}
        </Txt>
      </View>
      <View accessibilityLabel={`Conversations per week: ${person.weeks.join(", ")}`} style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 32 }}>
        {person.weeks.map((n, i) => (
          <View key={i} style={{ width: 7, height: Math.max(3, (n / max) * 32), borderRadius: 2, backgroundColor: i === person.weeks.length - 1 ? colors.ink : colors.faint }} />
        ))}
      </View>
    </Sketch>
  );
}
