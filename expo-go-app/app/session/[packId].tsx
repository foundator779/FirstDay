import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Modal, Pressable, TextInput, View } from "react-native";
import { brainApi } from "../../src/brain";
import { buzz, hush, say } from "../../src/device";
import { buildChoices, compareUnderstanding, gradeWords, queueFor, type Understanding } from "../../src/logic/training";
import type { Rule, SessionMode } from "../../src/logic/types";
import { useStore } from "../../src/store";
import { characterFor, Face } from "../../src/ui/faces";
import { Icon } from "../../src/ui/icons";
import { Btn, Dots, IconBtn, Label, Marked, Quote, Screen, Sketch, Txt, useUI } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

type Phase = "card" | "ask" | "right" | "wrong" | "end";

export default function Session() {
  const params = useLocalSearchParams<{ packId: string; mode?: string }>();
  const { state, actions } = useStore();
  const { s, settings } = useUI();
  const mode = (["learn", "review", "change"].includes(params.mode ?? "") ? params.mode : "learn") as SessionMode;

  const [plan] = useState(() => {
    const r = state.resume;
    if (r && r.packId === params.packId && r.mode === mode && r.index < r.ruleIds.length) return { ids: r.ruleIds, start: r.index, applyChange: false };
    const pack = state.packs.find((p) => p.id === params.packId);
    if (!pack) return { ids: [] as string[], start: 0, applyChange: false };
    if (mode === "change") return { ids: pack.pendingUpdates.map((u) => u.ruleId), start: 0, applyChange: true };
    return { ids: queueFor(pack, mode, state.progress, settings.cardsPerSession, Date.now()), start: 0, applyChange: false };
  });
  const [ready, setReady] = useState(!plan.applyChange);
  useEffect(() => {
    // A Change Drill swaps in the new rule; the old action becomes `changedFrom` (and a trap answer).
    if (!plan.applyChange) return;
    actions.applyUpdates(params.packId);
    setReady(true);
  }, []);

  const pack = state.packs.find((p) => p.id === params.packId);
  const [index, setIndex] = useState(plan.start);
  const [phase, setPhase] = useState<Phase>(mode === "review" ? "ask" : "card");
  const [attempt, setAttempt] = useState(0);
  const [missed, setMissed] = useState(false);
  const [eliminated, setEliminated] = useState<string[]>([]);
  const [wordsMode, setWordsMode] = useState(settings.answerStyle === "words");
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ hits: string[]; misses: string[]; note?: string } | null>(null);
  const [firstTryWins, setFirstTryWins] = useState(0);
  const [understand, setUnderstand] = useState<{ text: string; result?: Understanding } | null>(null);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkText, setParkText] = useState("");
  const [startedAt] = useState(Date.now());
  const [tick, setTick] = useState(0);
  const [timerDismissed, setTimerDismissed] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  const rule: Rule | undefined = pack?.rules.find((r) => r.id === plan.ids[index]);
  const who = characterFor(rule?.id ?? "x");
  const choices = useMemo(() => (rule && pack ? buildChoices(rule, pack, attempt) : []), [rule, pack, attempt]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    return () => hush();
  }, []);

  // Keep a resume point so leaving mid-way never loses progress.
  useEffect(() => {
    if (!pack) return;
    if (phase === "end" || index >= plan.ids.length) actions.setResume(null);
    else actions.setResume({ packId: pack.id, mode, ruleIds: plan.ids, index });
  }, [index, phase]);

  // Gentle focus timer.
  useEffect(() => {
    if (!settings.focusMinutes) return;
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, [settings.focusMinutes]);
  // `tick` re-renders every 5s so the bar moves.
  const elapsed = tick >= 0 ? (Date.now() - startedAt) / 60000 : 0;
  const timeUp = !!settings.focusMinutes && elapsed >= settings.focusMinutes && !timerDismissed;

  useEffect(() => {
    if (!reduceMotion) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
    if (!rule || !settings.readAloud) return;
    if (phase === "card") say(mode === "change" ? `This changed. Now: ${rule.action}` : `${rule.situation} ${rule.action}`);
    if (phase === "ask") say(`${rule.customerLine ?? rule.situation} What do you do?`);
  }, [phase, index]);

  if (!ready) return null;
  if (!pack || plan.ids.length === 0) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <Txt v="h2">Nothing to practise here right now.</Txt>
      </Screen>
    );
  }

  const quit = () => {
    hush();
    router.back();
  };

  const nextCard = () => {
    hush();
    setAttempt(0);
    setMissed(false);
    setEliminated([]);
    setAnswer("");
    setFeedback(null);
    setUnderstand(null);
    if (index + 1 >= plan.ids.length) {
      setPhase("end");
      actions.setResume(null);
      buzz.good();
    } else {
      setIndex(index + 1);
      setPhase(mode === "review" ? "ask" : "card");
    }
  };

  const onRight = () => {
    if (!rule) return;
    actions.recordAnswer(rule.id, !missed);
    if (!missed) setFirstTryWins((x) => x + 1);
    setPhase("right");
    buzz.good();
  };
  const onWrong = (choiceText?: string) => {
    setMissed(true);
    if (choiceText) setEliminated((e) => [...e, choiceText]);
    setPhase("wrong");
    buzz.nope();
  };

  const checkWords = async () => {
    if (!rule || !answer.trim()) return;
    const local = gradeWords(answer, rule);
    let pass = local.pass;
    let note: string | undefined;
    if (!pass && state.brain?.ai) {
      setChecking(true);
      try {
        const g = await brainApi.grade(state.brain, { situation: rule.situation, instruction: rule.action, quote: rule.quote, answer });
        pass = g.pass;
        note = g.feedback;
      } catch {}
      setChecking(false);
    }
    setFeedback({ hits: local.hits, misses: local.misses, ...(note ? { note } : {}) });
    if (pass) onRight();
    else onWrong();
  };

  // ---------- end ----------
  if (phase === "end") {
    return (
      <Screen
        footer={
          <>
            <Btn kind="primary" icon="check" label="Done for now" onPress={quit} />
            <Btn kind="quiet" label="Another round" onPress={() => router.replace(`/session/${pack.id}?mode=review`)} />
          </>
        }
      >
        <View style={{ alignItems: "center", gap: 12, paddingTop: 50 }}>
          <Icon name="star" size={64} strokeWidth={2.2} />
          <Txt v="hero" center>
            Nice work.
          </Txt>
          <Txt center>
            {plan.ids.length} situation{plan.ids.length > 1 ? "s" : ""} practised · {firstTryWins} right first time
          </Txt>
          <Sketch seed="break" dashed fill={colors.wash} style={{ padding: 16, marginTop: 10, gap: 4 }}>
            <Txt v="h2" center>
              Brain break?
            </Txt>
            <Txt center dim>
              Stand up, stretch, sip some water. I'll bring these back right before you'd forget them.
            </Txt>
          </Sketch>
        </View>
      </Screen>
    );
  }

  if (!rule) return null;
  const trainer = pack.trainer;

  const header = (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <IconBtn name="close" label="Stop. Progress is saved." onPress={quit} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Dots total={plan.ids.length} done={index} current={index} />
        </View>
        <IconBtn name="bulb" label="Park a thought" onPress={() => setParkOpen(true)} />
      </View>
      {!!settings.focusMinutes && (
        <View style={{ height: 4, backgroundColor: colors.faint, borderRadius: 2, overflow: "hidden" }}>
          <View style={{ height: 4, width: `${Math.min(100, (elapsed / settings.focusMinutes) * 100)}%`, backgroundColor: colors.ink }} />
        </View>
      )}
      {timeUp && (
        <Sketch seed="timeup" fill={colors.highlightSoft} style={{ padding: 12, gap: 8 }}>
          <Txt v="small">Your {settings.focusMinutes}-minute sprint is up. Finish this card and take a break?</Txt>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn small style={{ flex: 1 }} label="Keep going" onPress={() => setTimerDismissed(true)} />
            <Btn small style={{ flex: 1 }} label="Stop here" onPress={quit} />
          </View>
        </Sketch>
      )}
    </View>
  );

  const park = (
    <Modal visible={parkOpen} transparent animationType="fade" onRequestClose={() => setParkOpen(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(30,30,30,0.35)", justifyContent: "center", padding: 20 }}>
        <Sketch seed="park" shadow style={{ padding: 18, gap: 12 }}>
          <Txt v="h2">Park a thought</Txt>
          <Txt v="small" dim>
            Get it out of your head. It'll be waiting in Today.
          </Txt>
          <TextInput
            value={parkText}
            onChangeText={setParkText}
            autoFocus
            multiline
            placeholder="e.g. ask Maya about extensions"
            placeholderTextColor={colors.pencil}
            accessibilityLabel="Thought"
            style={{ minHeight: 80, fontFamily: fonts.body, fontSize: s.body, color: colors.ink, textAlignVertical: "top" }}
          />
          <Btn
            kind="primary"
            label="Park it"
            disabled={!parkText.trim()}
            onPress={() => {
              actions.addTodo(parkText.trim(), "later");
              setParkText("");
              setParkOpen(false);
              buzz.good();
            }}
          />
          <Btn kind="quiet" label="Never mind" onPress={() => setParkOpen(false)} />
        </Sketch>
      </View>
    </Modal>
  );

  // ---------- learn / change card ----------
  if (phase === "card") {
    const isChange = mode === "change" && !!rule.changedFrom;
    return (
      <Screen footer={<Btn kind="primary" icon="play" label="Got it. Let me try" onPress={() => setPhase("ask")} />}>
        {header}
        {park}
        <Animated.View style={{ opacity: fade, gap: 16 }}>
          <Sketch seed={`card${rule.id}`} shadow style={{ padding: 20, gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Label>{isChange ? "This changed" : "When"}</Label>
              <View style={{ flex: 1 }} />
              <IconBtn name="speaker" label="Read aloud" onPress={() => say(isChange ? `Before: ${rule.changedFrom}. Now: ${rule.action}` : `${rule.situation} ${rule.action}`)} />
            </View>
            <Txt v="h2">{rule.situation}</Txt>
            {isChange && (
              <View style={{ gap: 4 }}>
                <Label>Before</Label>
                <Txt dim style={{ textDecorationLine: "line-through" }}>
                  {rule.changedFrom}
                </Txt>
              </View>
            )}
            <Label>{isChange ? "Now" : "You"}</Label>
            <Marked v="title" text={rule.action} keywords={rule.keywords} />
            <Quote who={trainer} text={rule.quote} />
          </Sketch>

          {!understand ? (
            <Btn kind="quiet" icon="pencil" label="Check what I understood" onPress={() => setUnderstand({ text: "" })} />
          ) : (
            <Sketch seed="understand" fill={colors.wash} style={{ padding: 16, gap: 10 }}>
              <Txt v="small" bold>
                In your own words, what will you do?
              </Txt>
              <TextInput
                value={understand.text}
                onChangeText={(t) => setUnderstand({ text: t })}
                placeholder="Type, or tap 🎤 on the keyboard"
                placeholderTextColor={colors.pencil}
                multiline
                accessibilityLabel="What you will do"
                style={{ minHeight: 56, fontFamily: fonts.body, fontSize: s.body, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.faint }}
              />
              {understand.result ? (
                <View style={{ gap: 4 }}>
                  <Txt bold>
                    {understand.result.verdict === "match"
                      ? "That matches what was said."
                      : understand.result.verdict === "partial"
                        ? "Close. One thing is missing."
                        : "That's different from the source."}
                  </Txt>
                  {understand.result.missing.length > 0 && <Txt v="small">Missing: {understand.result.missing.join(", ")}</Txt>}
                  {understand.result.outdated.length > 0 && <Txt v="small">That's the old way: {understand.result.outdated.join(", ")}</Txt>}
                  <Txt v="tiny" dim>
                    Not scored. Just a check before you practise.
                  </Txt>
                </View>
              ) : (
                <Btn small label="Compare with the source" disabled={!understand.text.trim()} onPress={() => setUnderstand({ text: understand.text, result: compareUnderstanding(understand.text, rule) })} />
              )}
            </Sketch>
          )}
        </Animated.View>
      </Screen>
    );
  }

  // ---------- feedback ----------
  if (phase === "right" || phase === "wrong") {
    const right = phase === "right";
    return (
      <Screen
        footer={
          right ? (
            <Btn kind="primary" icon="play" label={index + 1 >= plan.ids.length ? "Finish" : "Next"} onPress={nextCard} />
          ) : (
            <>
              <Btn
                kind="primary"
                icon="refresh"
                label="Try again"
                onPress={() => {
                  setAttempt((a) => a + 1);
                  setAnswer("");
                  setFeedback(null);
                  setPhase("ask");
                }}
              />
              {wordsMode && <Btn kind="quiet" label="Show me choices instead" onPress={() => { setWordsMode(false); setFeedback(null); setPhase("ask"); }} />}
            </>
          )
        }
      >
        {header}
        {park}
        <Animated.View style={{ opacity: fade, gap: 16 }}>
          <View style={{ alignItems: "center", gap: 6, paddingTop: 10 }}>
            <Icon name={right ? "check" : "refresh"} size={54} strokeWidth={2.6} />
            <Txt v="hero" center>
              {right ? (missed ? "Got it this time." : "Yes! That's it.") : "Not quite. No stress."}
            </Txt>
          </View>
          {feedback?.note && <Txt center>{feedback.note}</Txt>}
          {feedback && !right && feedback.misses.length > 0 && <Txt center dim>Missing: {feedback.misses.join(", ")}</Txt>}
          <Sketch seed={`fb${rule.id}`} style={{ padding: 18, gap: 10 }}>
            <Label>{right ? "Exactly right" : "What to do"}</Label>
            <Marked v="h2" text={rule.action} keywords={rule.keywords} />
            <Quote who={trainer} text={rule.quote} />
          </Sketch>
        </Animated.View>
      </Screen>
    );
  }

  // ---------- ask ----------
  const visible = choices.filter((c) => !eliminated.includes(c.text));
  return (
    <Screen
      footer={
        wordsMode ? (
          <>
            <Btn kind="primary" icon="check" label={checking ? "Checking…" : "Check my answer"} disabled={!answer.trim() || checking} onPress={() => void checkWords()} />
            <Btn kind="quiet" label="Show choices instead" onPress={() => setWordsMode(false)} />
          </>
        ) : (
          <Btn kind="quiet" icon="pencil" label="Answer in my own words" onPress={() => setWordsMode(true)} />
        )
      }
    >
      {header}
      {park}
      <Animated.View style={{ opacity: fade, gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <Face who={who} size={64} />
          <Sketch seed={`bubble${rule.id}`} style={{ flex: 1, padding: 14, gap: 4 }}>
            <Txt v="tiny" dim bold>
              {rule.customerLine ? `${who.name.toUpperCase()} SAYS` : "THE SITUATION"}
            </Txt>
            <Txt v="h2">{rule.customerLine ? `“${rule.customerLine}”` : rule.situation}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Hear the situation" onPress={() => say(rule.customerLine ?? rule.situation)} hitSlop={8} style={{ alignSelf: "flex-start", paddingTop: 2 }}>
              <Icon name="speaker" size={22} color={colors.pencil} />
            </Pressable>
          </Sketch>
        </View>
        <Txt v="title">What do you do?</Txt>
        {wordsMode ? (
          <Sketch seed="words" style={{ padding: 14, minHeight: 130 }}>
            <TextInput
              value={answer}
              onChangeText={setAnswer}
              multiline
              autoFocus
              placeholder="Type it, or tap 🎤 on the keyboard and say it"
              placeholderTextColor={colors.pencil}
              accessibilityLabel="Your answer"
              style={{ minHeight: 100, fontFamily: fonts.body, fontSize: s.body, color: colors.ink, textAlignVertical: "top" }}
            />
            {checking && <ActivityIndicator color={colors.ink} />}
          </Sketch>
        ) : (
          visible.map((c) => (
            <Btn key={c.text} label={c.text} align="left" onPress={() => (c.correct ? onRight() : onWrong(c.text))} />
          ))
        )}
      </Animated.View>
    </Screen>
  );
}
