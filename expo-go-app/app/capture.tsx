import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { brainApi } from "../src/brain";
import { buzz } from "../src/device";
import { friendlyDay } from "../src/logic/dates";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Btn, Empty, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Mode = "pick" | "note" | "paste" | "bee";
type Result = { id: string };

export default function Capture() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const { state, actions } = useStore();
  const { s } = useUI();
  const [mode, setMode] = useState<Mode>((params.mode as Mode) || "pick");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [beeList, setBeeList] = useState<{ id: string; title: string; at: number }[] | null>(null);
  const [beeError, setBeeError] = useState("");

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

  const back = () => (mode === "pick" || params.mode ? router.back() : setMode("pick"));

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

  if (mode === "bee") {
    return (
      <Screen>
        <TopBar title="From my Bee" onBack={back} close={!!params.mode} />
        {!state.brain?.bee ? (
          <Sketch seed="no-bee" dashed fill={colors.wash} style={{ padding: 18, gap: 10 }}>
            <Txt>To bring in Bee conversations, run the small brain helper on your computer (it uses your Bee CLI login), then connect it here.</Txt>
            <Btn small icon="link" label="Connect the brain" onPress={() => router.push("/settings")} />
          </Sketch>
        ) : beeError ? (
          <Empty icon="close" text={beeError} />
        ) : !beeList ? (
          <ActivityIndicator color={colors.ink} />
        ) : beeList.length === 0 ? (
          <Empty icon="bee" text="No Bee conversations yet." />
        ) : (
          beeList.map((b) => {
            const have = state.conversations.some((c) => c.beeId === b.id);
            return (
              <Pressable
                key={b.id}
                accessibilityRole="button"
                disabled={have}
                onPress={async () => {
                  if (!state.brain) return;
                  setBusy(true);
                  try {
                    const full = await brainApi.beeGet(state.brain, b.id);
                    await finish({ text: full.text, source: "bee", title: full.title, at: full.at, beeId: full.id });
                  } catch {
                    setBusy(false);
                    setBeeError("Couldn't load that conversation.");
                  }
                }}
              >
                <Sketch seed={b.id} style={{ padding: 14, opacity: have ? 0.5 : 1 }}>
                  <Txt numberOfLines={2}>{b.title}</Txt>
                  <Txt v="small" dim>
                    {friendlyDay(b.at, Date.now())}
                    {have ? " · already here" : ""}
                  </Txt>
                </Sketch>
              </Pressable>
            );
          })
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
        <Txt dim>Tap the 🎤 on your keyboard and just talk. Messy is fine.</Txt>
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
        {state.brain?.ai ? "Read by your brain helper (Bedrock). Stays between your phone and computer." : "Read on your phone. Nothing leaves it."}
      </Txt>
    </Screen>
  );
}
