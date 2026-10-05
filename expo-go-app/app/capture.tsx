import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { brainApi } from "../src/brain";
import { buzz } from "../src/device";
import { friendlyDay } from "../src/logic/dates";
import { AI_LABEL, useSmartAi } from "../src/smart";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, CheckBox, Empty, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Mode = "pick" | "note" | "paste" | "bee";
type Result = { id: string };

export default function Capture() {
  // beeId/beeTitle/beeAt arrive from the "New from Bee" banner or notification.
  const params = useLocalSearchParams<{ mode?: string; beeId?: string; beeTitle?: string; beeAt?: string }>();
  const { state, actions } = useStore();
  const smart = useSmartAi();
  const { s } = useUI();
  const fromInbox = typeof params.beeId === "string" && params.beeId ? params.beeId : "";
  const [mode, setMode] = useState<Mode>(fromInbox ? "bee" : (params.mode as Mode) || "pick");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [beeList, setBeeList] = useState<{ id: string; title: string; at: number; ready?: boolean }[] | null>(null);
  const [beeError, setBeeError] = useState("");
  // A Bee conversation waiting for the learner's consent before it's read.
  const [pending, setPending] = useState<{ id: string; title: string; at: number } | null>(
    fromInbox ? { id: fromInbox, title: params.beeTitle || "Bee conversation", at: Number(params.beeAt) || Date.now() } : null,
  );
  const [consent, setConsent] = useState(false);

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

  if (result) {
    const convo = state.conversations.find((c) => c.id === result.id);
    const todos = state.todos.filter((t) => t.fromId === result.id).length;
    const memories = state.memories.filter((m) => m.fromId === result.id).length;
    const rules = state.suggestedRules.filter((r) => r.fromId === result.id).length;
    return (
      <Screen
        footer={
          <>
            {todos + memories > 0 && <Btn kind="primary" icon="play" label="Sort them now" onPress={() => router.replace("/sort")} />}
            {rules > 0 && <Btn icon="cap" label={`Check ${rules} work step${rules > 1 ? "s" : ""}`} onPress={() => router.replace(`/confirm?from=${result.id}`)} />}
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
          <Txt>• {todos} to-do{todos === 1 ? "" : "s"}</Txt>
          <Txt>• {memories} thing{memories === 1 ? "" : "s"} to remember</Txt>
          <Txt>• {rules} work step{rules === 1 ? "" : "s"} to practise</Txt>
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
          <Txt dim>Finding to-dos, memories and work steps.</Txt>
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
        <Option icon="bee" title="From my Bee" sub={state.brain?.bee ? "Bring in a recorded conversation." : "Connect the brain on your computer first."} onPress={() => setMode("bee")} />
        <Option icon="chat" title="Paste a transcript" sub="Copied from Bee or anywhere else. Great for training." onPress={() => setMode("paste")} />
      </Screen>
    );
  }

  if (mode === "bee" && pending) {
    const already = state.conversations.find((c) => c.beeId === pending.id);
    const importIt = async () => {
      if (already) {
        actions.dismissBeeInbox([pending.id]);
        router.replace(`/convo/${already.id}`);
        return;
      }
      if (!state.brain) return;
      setBusy(true);
      try {
        const full = await brainApi.beeGet(state.brain, pending.id);
        setPending(null);
        actions.dismissBeeInbox([full.id]);
        await finish({ text: full.text, source: "bee", title: full.title, at: full.at, beeId: full.id });
      } catch (e) {
        setBusy(false);
        setPending(null);
        setBeeError(e instanceof Error ? e.message : "Couldn't load that conversation.");
      }
    };
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
          <CheckBox label="Everyone agreed" on={consent} onPress={() => setConsent(!consent)} />
          <Txt style={{ flex: 1 }}>Everyone who speaks in this recording agreed to it being used for my practice.</Txt>
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
            <Txt>To bring in Bee conversations, run the small brain helper on your computer (it uses your Bee CLI login), then connect it here.</Txt>
            <Btn small icon="link" label="Connect the brain" onPress={() => router.push("/settings")} />
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
            const have = state.conversations.some((c) => c.beeId === b.id);
            return (
              <Pressable
                key={b.id}
                accessibilityRole="button"
                disabled={have || b.ready === false}
                onPress={() => {
                  setBeeError("");
                  setConsent(false);
                  setPending({ id: b.id, title: b.title, at: b.at });
                }}
              >
                <Sketch seed={b.id} style={{ padding: 14, opacity: have || b.ready === false ? 0.5 : 1 }}>
                  <Txt numberOfLines={2}>{b.title}</Txt>
                  <Txt v="small" dim>
                    {friendlyDay(b.at, Date.now())}
                    {have ? " · already here" : b.ready === false ? " · Bee is still processing" : ""}
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
        <TextInput
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
        <TextInput
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
