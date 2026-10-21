import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { beeCloudAvailable } from "../src/beeCloud";
import { brainApi } from "../src/brain";
import { buzz } from "../src/device";
import { friendlyDay } from "../src/logic/dates";
import { REAL_RECORDINGS, realRecording } from "../src/logic/replays";
import { AI_LABEL, useSmartAi } from "../src/smart";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, CheckBox, Empty, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Mode = "pick" | "note" | "paste" | "bee" | "replay";
type Result = { id: string };

export default function Capture() {
  // beeId/beeTitle/beeAt arrive from the "New from Bee" banner or notification.
  // ok=1 means you already said yes on Today's card, so it's read straight away.
  const params = useLocalSearchParams<{ mode?: string; beeId?: string; beeTitle?: string; beeAt?: string; ok?: string }>();
  const { state, actions } = useStore();
  const smart = useSmartAi();
  const { s } = useUI();
  const fromInbox = typeof params.beeId === "string" && params.beeId ? params.beeId : "";
  const [mode, setMode] = useState<Mode>(fromInbox ? "bee" : (params.mode as Mode) || "pick");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  // Coming from Today's "Yes, read it", show "Reading it…" from the first frame instead of a consent screen.
  const [busy, setBusy] = useState(() => params.ok === "1" && !!params.beeId && !!state.brain?.bee);
  const [result, setResult] = useState<Result | null>(null);
  const [beeList, setBeeList] = useState<{ id: string; title: string; at: number; ready?: boolean }[] | null>(null);
  const [beeError, setBeeError] = useState("");
  // A Bee conversation waiting for your OK before it's read.
  const [pending, setPending] = useState<{ id: string; title: string; at: number } | null>(
    fromInbox ? { id: fromInbox, title: params.beeTitle || "Bee conversation", at: Number(params.beeAt) || Date.now() } : null,
  );
  const [consent, setConsent] = useState(false);
  // A real Bee recording saved in the app, waiting for your OK before it's replayed.
  const [replayPick, setReplayPick] = useState<string | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (mode !== "bee" || !state.brain?.bee || beeList) return;
    brainApi
      .beeList(state.brain)
      .then((r) => setBeeList(r.conversations))
      .catch((e: unknown) => setBeeError(e instanceof Error ? e.message : "Couldn't reach Bee."));
  }, [mode, state.brain, beeList]);

  const finish = async (input: Parameters<typeof actions.capture>[0]) => {
    setBusy(true);
    const id = await actions.capture(input);
    setResult({ id });
    setBusy(false);
    buzz.good();
  };

  /** Reads one Bee conversation you said yes to. One you already brought in just opens. */
  const importBee = async (p: { id: string }) => {
    const already = state.conversations.find((c) => c.beeId === p.id);
    if (already) {
      actions.dismissBeeInbox([p.id]);
      router.replace(`/convo/${already.id}`);
      return;
    }
    if (!state.brain) return;
    setBusy(true);
    try {
      const full = await brainApi.beeGet(state.brain, p.id);
      setPending(null);
      actions.dismissBeeInbox([full.id]);
      await finish({ text: full.text, source: "bee", title: full.title, at: full.at, beeId: full.id });
    } catch (e) {
      setBusy(false);
      setPending(null);
      setBeeError(e instanceof Error ? e.message : "Couldn't load that conversation.");
    }
  };

  useEffect(() => {
    if (params.ok !== "1" || !fromInbox || !state.brain?.bee || autoStarted.current) return;
    autoStarted.current = true;
    void importBee({ id: fromInbox });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ok, fromInbox, state.brain]);

  if (result) {
    const convo = state.conversations.find((c) => c.id === result.id);
    const todos = state.todos.filter((t) => t.fromId === result.id).length;
    const memories = state.memories.filter((m) => m.fromId === result.id).length;
    const rules = state.suggestedRules.filter((r) => r.fromId === result.id).length;
    const questions = state.questions.filter((q) => q.fromId === result.id).length;
    const wins = state.wins.filter((w) => w.fromId === result.id && w.suggested).length;
    // Work steps come first: practising them is what the app is for. To-dos and memories can wait in More.
    return (
      <Screen
        footer={
          <>
            {rules > 0 && <Btn kind="primary" icon="cap" label={`Check ${rules} work step${rules > 1 ? "s" : ""}`} onPress={() => router.replace(`/confirm?from=${result.id}`)} />}
            {wins > 0 && <Btn kind={rules > 0 ? "plain" : "primary"} icon="star" label={`Keep ${wins} win${wins > 1 ? "s" : ""} for my record`} onPress={() => router.replace("/record")} />}
            {todos + memories > 0 && <Btn kind={rules > 0 || wins > 0 ? "plain" : "primary"} icon="play" label={`Sort ${todos + memories} to-do${todos + memories === 1 ? "" : "s"} and memories`} onPress={() => router.replace("/sort")} />}
            <Btn kind="quiet" label="Later. Back to today." onPress={() => router.back()} />
          </>
        }
      >
        <View style={{ alignItems: "center", gap: 10, paddingTop: 40 }}>
          <Icon name="check" size={56} strokeWidth={2.6} />
          <Txt v="hero" center>
            Got it.
          </Txt>
          <Txt center dim>
            {convo?.title}
          </Txt>
        </View>
        <Sketch seed="found" fill={colors.wash} style={{ padding: 18, gap: 6 }}>
          <Txt>• {rules} work step{rules === 1 ? "" : "s"} to practise</Txt>
          {questions > 0 && <Txt>• {questions} question{questions === 1 ? "" : "s"} for your trainer (in Questions)</Txt>}
          {wins > 0 && <Txt>• {wins} win{wins === 1 ? "" : "s"} for your record (praise, word for word)</Txt>}
          <Txt>• {todos} to-do{todos === 1 ? "" : "s"}</Txt>
          <Txt>• {memories} thing{memories === 1 ? "" : "s"} to remember</Txt>
        </Sketch>
        {convo?.summary[0] && <Txt dim>“{convo.summary[0]}”</Txt>}
      </Screen>
    );
  }

  if (busy) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
          <ActivityIndicator color={colors.ink} />
          <Txt v="h2">Reading it…</Txt>
          <Txt dim>Finding work steps, questions for your trainer, to-dos and memories.</Txt>
        </View>
      </Screen>
    );
  }

  const back = () => (mode === "pick" || params.mode || fromInbox ? router.back() : setMode("pick"));

  if (mode === "pick") {
    const Option = ({ icon, title: t, sub, onPress }: { icon: "mic" | "bee" | "chat"; title: string; sub: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={t} onPress={onPress}>
        <Sketch seed={t} style={{ padding: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Icon name={icon} size={34} />
          <View style={{ flex: 1 }}>
            <Txt v="h2">{t}</Txt>
            <Txt v="small" dim>
              {sub}
            </Txt>
          </View>
        </Sketch>
      </Pressable>
    );
    return (
      <Screen>
        <TopBar title="Capture" onBack={back} close />
        <Option icon="mic" title="Talk or type" sub="A thought, a plan, what someone just told you." onPress={() => setMode("note")} />
        <Option icon="bee" title="From my Bee" sub={state.brain?.bee ? "Bring in a recorded conversation." : "Connect your Bee first."} onPress={() => setMode("bee")} />
        <Option icon="chat" title="Paste a transcript" sub="Copied from Bee or anywhere else. Great for training." onPress={() => setMode("paste")} />
        <Option icon="bee" title="Replay a real Bee recording" sub="Recorded on an Apple Watch on Oct 18. No Bee needed." onPress={() => setMode("replay")} />
      </Screen>
    );
  }

  if (mode === "replay") {
    const rec = replayPick ? realRecording(replayPick) : undefined;
    const when = (at: number) => new Date(at).toLocaleString([], { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    if (rec) {
      return (
        <Screen
          footer={
            <Btn
              kind="primary"
              icon="check"
              label="Replay it"
              disabled={!consent}
              onPress={() => void finish({ text: rec.text, source: "bee", title: rec.title, at: rec.recordedAt, replayId: rec.id })}
            />
          }
        >
          <TopBar title="Before we read it" onBack={() => setReplayPick(null)} />
          <Sketch seed={`replay-${rec.id}`} style={{ padding: 16, gap: 4 }}>
            <Txt v="tiny" dim bold>
              REPLAY OF A REAL BEE RECORDING
            </Txt>
            <Txt v="h2">{rec.title}</Txt>
            <Txt v="small" dim>
              Recorded by Bee on an Apple Watch · {when(rec.recordedAt)}
            </Txt>
          </Sketch>
          <Txt>{rec.about}</Txt>
          <Sketch seed={`replay-text-${rec.id}`} dashed fill={colors.wash} style={{ padding: 14, gap: 2 }}>
            <Txt v="tiny" dim bold>
              BEE'S TRANSCRIPT, WORD FOR WORD
            </Txt>
            {rec.text.split("\n").map((line, i) => (
              <Txt key={i} v="small">
                {line}
              </Txt>
            ))}
          </Sketch>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <CheckBox label="I agree" on={consent} onPress={() => setConsent(!consent)} />
            <Txt style={{ flex: 1 }}>I'm OK with FirstDay Go reading this conversation.</Txt>
          </View>
          <Txt v="small" dim>
            {smart === "cloud"
              ? "Bee's transcript is saved in the app, so this works without a Bee. Amazon Bedrock reads it now, live, through your FirstDay account, the same way as a new Bee conversation."
              : "Bee's transcript is saved in the app, so this works without a Bee. Sign in to have Amazon Bedrock read it; until then it's read on this phone."}
          </Txt>
        </Screen>
      );
    }
    return (
      <Screen>
        <TopBar title="Real Bee recordings" onBack={back} close={!!params.mode} />
        <Txt dim>
          Recorded by Bee on an Apple Watch on October 18, 2026, the day we filmed the demo. Replay one to see the whole path with real
          data, without a Bee of your own. Nothing is prepared in advance: Amazon Bedrock reads it when you say yes.
        </Txt>
        {REAL_RECORDINGS.map((r) => {
          const mine = state.conversations.find((c) => c.replayId === r.id);
          return (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityHint={mine ? "Opens the replay you already did" : undefined}
              onPress={() => {
                if (mine) {
                  router.push(`/convo/${mine.id}`);
                  return;
                }
                setConsent(false);
                setReplayPick(r.id);
              }}
            >
              <Sketch seed={r.id} style={{ padding: 14, gap: 4 }}>
                <Txt v="tiny" dim bold>
                  REAL · APPLE WATCH · {when(r.recordedAt).toUpperCase()}
                </Txt>
                <Txt v="h2">{r.title}</Txt>
                <Txt v="small" dim>
                  {mine ? "Already here, tap to open" : r.about}
                </Txt>
              </Sketch>
            </Pressable>
          );
        })}
      </Screen>
    );
  }

  if (mode === "bee" && pending) {
    const importIt = () => importBee(pending);
    return (
      <Screen footer={<Btn kind="primary" icon="check" label="Use this conversation" disabled={!consent} onPress={() => void importIt()} />}>
        <TopBar title="Before we read it" onBack={() => (fromInbox ? router.back() : setPending(null))} />
        <Sketch seed={`bee-${pending.id}`} style={{ padding: 16, gap: 4 }}>
          <Txt v="tiny" dim bold>
            REAL BEE RECORDING
          </Txt>
          <Txt v="h2">{pending.title}</Txt>
          <Txt v="small" dim>
            {friendlyDay(pending.at, Date.now())}
          </Txt>
        </Sketch>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <CheckBox label="I agree" on={consent} onPress={() => setConsent(!consent)} />
          <Txt style={{ flex: 1 }}>I'm OK with FirstDay Go reading this conversation.</Txt>
        </View>
        <Txt v="small" dim>
          {smart === "cloud"
            ? "The transcript is read by Amazon Bedrock through your FirstDay account (not stored there) and saved only on this phone. You can delete it any time."
            : smart === "brain"
              ? "The transcript is read by Amazon Bedrock through the brain on your computer and saved only on this phone. You can delete it any time."
              : "The transcript is read on this phone and saved only here. You can delete it any time."}
        </Txt>
      </Screen>
    );
  }

  if (mode === "bee") {
    return (
      <Screen>
        <TopBar title="From my Bee" onBack={back} close={!!params.mode} />
        {!state.brain?.bee ? (
          <Sketch seed="no-bee" dashed fill={colors.wash} style={{ padding: 18, gap: 10 }}>
            <Txt>To bring in Bee conversations, connect your Bee account first. No computer needed.</Txt>
            {beeCloudAvailable && <Btn small icon="link" label="Connect my Bee" onPress={() => router.push("/bee-connect")} />}
            <Btn small kind="quiet" align="left" label="Or use the helper on a computer (Settings)" onPress={() => router.push("/settings")} />
          </Sketch>
        ) : beeError && !beeList ? (
          <Empty icon="close" text={beeError} />
        ) : !beeList ? (
          <ActivityIndicator color={colors.ink} />
        ) : beeList.length === 0 ? (
          <Empty icon="bee" text="No Bee conversations yet." />
        ) : (
          <>
            {!!beeError && (
              <Sketch seed="bee-err" fill={colors.highlightSoft} style={{ padding: 12 }}>
                <Txt v="small" bold>
                  {beeError}
                </Txt>
              </Sketch>
            )}
            {beeList.map((b) => {
            const mine = state.conversations.find((c) => c.beeId === b.id);
            return (
              <Pressable
                key={b.id}
                accessibilityRole="button"
                accessibilityHint={mine ? "Opens the conversation you already brought in" : undefined}
                disabled={!mine && b.ready === false}
                onPress={() => {
                  if (mine) {
                    router.push(`/convo/${mine.id}`);
                    return;
                  }
                  setBeeError("");
                  setConsent(false);
                  setPending({ id: b.id, title: b.title, at: b.at });
                }}
              >
                <Sketch seed={b.id} style={{ padding: 14, opacity: !mine && b.ready === false ? 0.5 : 1 }}>
                  <Txt numberOfLines={2}>{b.title}</Txt>
                  <Txt v="small" dim>
                    {friendlyDay(b.at, Date.now())}
                    {mine ? " · already here, tap to open" : b.ready === false ? " · Bee is still processing" : ""}
                  </Txt>
                </Sketch>
              </Pressable>
            );
          })}
          </>
        )}
      </Screen>
    );
  }

  const isPaste = mode === "paste";
  return (
    <Screen
      footer={
        <Btn
          kind="primary"
          icon="check"
          label={isPaste ? "Find the steps" : "Save"}
          disabled={text.trim().split(/\s+/).length < 3}
          onPress={() => void finish({ text, source: isPaste ? "pasted" : "note", ...(title.trim() ? { title } : {}) })}
        />
      }
    >
      <TopBar title={isPaste ? "Paste a transcript" : "Talk or type"} onBack={back} close={!!params.mode} />
      {isPaste ? (
        <TextInput underlineColorAndroid="transparent"
          value={title}
          onChangeText={setTitle}
          placeholder="Name it (optional), e.g. Front desk training"
          placeholderTextColor={colors.pencil}
          accessibilityLabel="Title"
          style={{ fontFamily: fonts.body, fontSize: s.body, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.faint, paddingVertical: 10 }}
        />
      ) : (
        <Txt dim>Tap the mic key on your keyboard and just talk. Messy is fine.</Txt>
      )}
      <Sketch seed={mode} style={{ padding: 14, minHeight: 260 }}>
        <TextInput underlineColorAndroid="transparent"
          value={text}
          onChangeText={setText}
          autoFocus={!isPaste}
          multiline
          textAlignVertical="top"
          placeholder={isPaste ? "Maya: When a visitor borrows a reading kit, record the kit number in the blue ledger…" : "e.g. Dana asked me to restock receipt paper by noon. I need to email Priya tomorrow at 9…"}
          placeholderTextColor={colors.pencil}
          accessibilityLabel="Conversation text"
          style={{ flex: 1, minHeight: 230, fontFamily: fonts.body, fontSize: s.body, lineHeight: s.body * 1.45, color: colors.ink }}
        />
      </Sketch>
      <Txt v="small" dim>
        {AI_LABEL[smart ?? "phone"]}
      </Txt>
    </Screen>
  );
}
