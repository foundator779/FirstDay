import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { brainApi, normalizeUrl } from "../src/brain";
import { canNotify } from "../src/device";
import type { Settings } from "../src/logic/types";
import { useStore } from "../src/store";
import { Btn, Chip, Label, Screen, Sketch, Toggle, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

export default function SettingsScreen() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const st = state.settings;
  const [url, setUrl] = useState(state.brain?.url ?? "");
  const [code, setCode] = useState(state.brain?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (p: Partial<Settings>) => actions.setSettings(p);
  const field = { fontFamily: fonts.body, fontSize: s.body, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.faint, paddingVertical: 10 } as const;

  const connect = async () => {
    setBusy(true);
    setMsg("");
    const target = { url: normalizeUrl(url), code: code.trim() };
    try {
      const h = await brainApi.health(target);
      actions.setBrain({ ...target, ai: h.ai, bee: h.bee });
      setUrl(target.url);
      setMsg(`Connected. AI ${h.ai ? "on" : "off"} · Bee ${h.bee ? "on" : "off"}.`);
    } catch (e) {
      setMsg(e instanceof Error && e.message.includes("code") ? "Wrong code. Check the terminal." : "Couldn't reach it. Same Wi-Fi? Is the brain running?");
    }
    setBusy(false);
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Settings" />

      <Label>Practice</Label>
      <Txt v="small" dim>Cards per session</Txt>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {([3, 5, 10] as const).map((n) => (
          <Chip key={n} label={String(n)} on={st.cardsPerSession === n} onPress={() => set({ cardsPerSession: n })} />
        ))}
      </View>
      <Txt v="small" dim>Answer with</Txt>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip label="Choices" on={st.answerStyle === "choices"} onPress={() => set({ answerStyle: "choices" })} />
        <Chip label="My own words" on={st.answerStyle === "words"} onPress={() => set({ answerStyle: "words" })} />
      </View>
      <Txt v="small" dim>Focus sprint (a gentle timer in practice)</Txt>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {([0, 5, 10, 15] as const).map((n) => (
          <Chip key={n} label={n ? `${n} min` : "Off"} on={st.focusMinutes === n} onPress={() => set({ focusMinutes: n })} />
        ))}
      </View>

      <Label>Comfort</Label>
      <Toggle label="Read cards aloud" hint="Hear every situation without reading." on={st.readAloud} onChange={(v) => set({ readAloud: v })} />
      <Toggle label="Bigger text" on={st.bigText} onChange={(v) => set({ bigText: v })} />
      <Toggle label="Little buzzes" hint="Haptic taps when you finish things." on={st.haptics} onChange={(v) => set({ haptics: v })} />
      <Toggle
        label="Gentle nudges"
        hint="A notification when a to-do is due."
        on={st.nudges}
        onChange={async (v) => {
          if (v && !(await canNotify())) {
            Alert.alert("Notifications are off", "Turn them on for Expo Go in iPhone Settings to get nudges.");
          }
          set({ nudges: v });
        }}
      />

      <Label>Brain (optional)</Label>
      <Sketch seed="brain" fill={colors.wash} style={{ padding: 16, gap: 8 }}>
        <Txt v="small">
          Run <Txt v="small" bold>node brain/server.mjs</Txt> on your computer. It adds smarter AI (Amazon Bedrock) and your real Bee conversations. Keys stay on the computer. Type the address and code it prints:
        </Txt>
        <TextInput value={url} onChangeText={setUrl} placeholder="192.168.1.20:8790" placeholderTextColor={colors.pencil} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={field} accessibilityLabel="Brain address" />
        <TextInput value={code} onChangeText={setCode} placeholder="6-digit code" placeholderTextColor={colors.pencil} keyboardType="number-pad" style={field} accessibilityLabel="Pairing code" />
        {busy ? <ActivityIndicator color={colors.ink} /> : <Btn small icon="link" label={state.brain ? "Reconnect" : "Connect"} disabled={!url.trim() || !code.trim()} onPress={() => void connect()} />}
        {!!msg && <Txt v="small">{msg}</Txt>}
        {state.brain && !msg && <Txt v="small">Connected to {state.brain.url} · AI {state.brain.ai ? "on" : "off"} · Bee {state.brain.bee ? "on" : "off"}</Txt>}
        {state.brain && <Btn kind="quiet" align="left" label="Disconnect" onPress={() => { actions.setBrain(null); setMsg(""); }} />}
      </Sketch>

      <Label>Your data</Label>
      <Txt v="small" dim>Everything lives on this phone. No account, no cloud.</Txt>
      <Btn
        kind="quiet"
        align="left"
        icon="trash"
        label="Erase everything and start fresh"
        onPress={() =>
          Alert.alert("Erase everything?", "All conversations, to-dos, memories and practice will be deleted.", [
            { text: "Cancel", style: "cancel" },
            { text: "Erase", style: "destructive", onPress: () => { actions.resetAll(); router.back(); } },
          ])
        }
      />
    </Screen>
  );
}
