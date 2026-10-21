import { router } from "expo-router";
import { useState } from "react";
import { Platform, Share, TextInput, View } from "react-native";
import { buzz } from "../src/device";
import { byMonth, reviewText } from "../src/logic/wins";
import type { Win } from "../src/logic/types";
import { useStore } from "../src/store";
import { Btn, Empty, Label, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

const day = (at: number) => new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });

/** A praise line found in a conversation: it goes on your record only if you keep it. */
function Suggested({ win }: { win: Win }) {
  const { state, actions } = useStore();
  const { s } = useUI();
  const [who, setWho] = useState(win.who ?? "");
  const convo = state.conversations.find((c) => c.id === win.fromId);
  return (
    <Sketch seed={win.id} style={{ padding: 16, gap: 10 }}>
      <Txt v="tiny" dim bold>
        {`${win.source === "bee" ? "HEARD" : "FROM"} ${day(win.at).toUpperCase()}${convo ? ` · ${convo.title.toUpperCase()}` : ""}${win.replay ? " · REPLAY" : ""}`}
      </Txt>
      <Txt v="h2">“{win.quote ?? win.text}”</Txt>
      <TextInput
        value={who}
        onChangeText={setWho}
        placeholder="Who said it? (e.g. Rosa, your manager)"
        placeholderTextColor={colors.pencil}
        accessibilityLabel="Who said it"
        style={{ fontFamily: fonts.body, fontSize: s.body, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.faint, paddingVertical: 8 }}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn
          small
          kind="primary"
          style={{ flex: 1 }}
          icon="check"
          label="Keep it"
          onPress={() => {
            actions.keepWin(win.id, who);
            buzz.good();
          }}
        />
        <Btn small style={{ flex: 1 }} label="Not a win" onPress={() => actions.dropWin(win.id)} />
      </View>
    </Sketch>
  );
}

/** My record: proof for your reviews and promotions, dated and in other people's own words. See src/logic/wins.ts. */
export default function Record() {
  const { state, actions } = useStore();
  const [msg, setMsg] = useState("");
  const waiting = state.wins.filter((w) => w.suggested);
  const months = byMonth(state.wins);
  const text = reviewText(state.wins);

  const copy = async () => {
    setMsg("");
    try {
      const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { clipboard?: Clipboard }) : undefined;
      if (Platform.OS === "web" && nav?.clipboard) {
        await nav.clipboard.writeText(text);
        setMsg("Copied. Paste it into your self-review.");
      } else {
        await Share.share({ message: text });
      }
      buzz.good();
    } catch {
      setMsg("Couldn't copy it. Try again.");
    }
  };

  return (
    <Screen footer={months.length ? <Btn kind="primary" icon="list" label="Copy for my review" onPress={() => void copy()} /> : undefined}>
      <TopBar title="My record" sub="Proof for your reviews and promotions" onBack={() => router.back()} />

      {waiting.length > 0 && (
        <View style={{ gap: 10 }}>
          <Label line>{`Heard in your conversations · ${waiting.length} to keep`}</Label>
          <Txt v="small" dim>
            Praise and thanks for you, word for word, with the date Bee recorded it. Nothing goes on your record until you keep it.
          </Txt>
          {waiting.map((w) => (
            <Suggested key={w.id} win={w} />
          ))}
        </View>
      )}

      {months.length === 0 && waiting.length === 0 ? (
        <Empty
          icon="star"
          text="Wins show up here: praise and thanks from your Bee conversations (you keep the ones you want), and what you learn in FirstDay Go. At review time, copy them into your self-review."
        />
      ) : (
        months.map((g) => (
          <View key={g.month} style={{ gap: 8 }}>
            <Label line>{g.month}</Label>
            {g.wins.map((w) => (
              <Sketch key={w.id} seed={w.id} fill={w.kind === "praise" ? colors.card : colors.wash} style={{ padding: 14, gap: 4 }}>
                <Txt v="tiny" dim bold>
                  {`${day(w.at).toUpperCase()} · ${w.kind === "praise" ? `${w.who ? w.who.toUpperCase() : "SOMEONE"} SAID${w.replay ? " · REPLAY" : ""}` : "LEARNED IN FIRSTDAY GO"}`}
                </Txt>
                <Txt>{w.kind === "praise" ? `“${w.quote ?? w.text}”` : w.text}</Txt>
                {w.kind === "praise" && (
                  <Btn small kind="quiet" align="left" label="Remove from my record" onPress={() => actions.dropWin(w.id)} />
                )}
              </Sketch>
            ))}
          </View>
        ))
      )}
      {!!msg && <Txt v="small">{msg}</Txt>}
      <Txt v="small" dim>
        Your record stays on this device. It's yours: nothing here is shared with your employer unless you copy it.
      </Txt>
    </Screen>
  );
}
