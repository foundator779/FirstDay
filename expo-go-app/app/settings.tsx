import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { useSession } from "../src/auth";
import { brainApi, normalizeUrl } from "../src/brain";
import { cloudTarget } from "../src/cloud";
import { canNotify } from "../src/device";
import { friendlyDay } from "../src/logic/dates";
import type { Brain, Settings } from "../src/logic/types";
import { useStore } from "../src/store";
import { Btn, Chip, Label, Screen, Sketch, Toggle, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

export default function SettingsScreen() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const st = state.settings;
  const session = useSession();
  const [url, setUrl] = useState(state.brain?.url ?? "");
  const [code, setCode] = useState(state.brain?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cloudMsg, setCloudMsg] = useState("");
  const [beeMsg, setBeeMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const set = (p: Partial<Settings>) => actions.setSettings(p);
  const field = { fontFamily: fonts.body, fontSize: s.body, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.faint, paddingVertical: 10 } as const;

  const connect = async () => {
    setBusy(true);
    setMsg("");
    let target: { url: string; code: string; withToken?: boolean } = { url: normalizeUrl(url), code: code.trim() };
    try {
      let h;
      try {
        h = await brainApi.health(target);
      } catch (e) {
        // A brain that requires accounts answers "Sign in required": try again with the Cognito token.
        if (!(e instanceof Error && e.message.includes("Sign in")) || !session) throw e;
        target = { ...target, withToken: true };
        h = await brainApi.health(target);
      }
      const brain = { ...target, ai: h.ai, bee: !!h.bee, live: !!h.live };
      actions.setBrain(brain);
      setUrl(target.url);
      setMsg(`Connected. AI ${h.ai ? "on" : "off"} · Bee ${h.bee ? "on" : "off"}.`);
      if (h.bee) void syncNow(brain);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setMsg(
        m.includes("Too many") ? m
        : m.includes("code") ? "Wrong code. Check the terminal."
        : m.includes("Sign in") ? "This brain needs a signed-in account. Sign in above, then connect."
        : "Couldn't reach it. Same Wi-Fi? Is the brain running?",
      );
    }
    setBusy(false);
  };

  const checkCloud = async () => {
    setCloudMsg("Checking…");
    const started = Date.now();
    try {
      const r = await brainApi.steps(cloudTarget, "Put away the groceries");
      setCloudMsg(r.steps.length ? `Working. Amazon Bedrock answered in ${((Date.now() - started) / 1000).toFixed(1)} s.` : "It answered, but with nothing in it.");
    } catch (e) {
      setCloudMsg(e instanceof Error ? e.message : "Couldn't reach it.");
    }
  };

  const syncNow = async (brain?: Brain) => {
    setSyncing(true);
    setBeeMsg(await actions.syncBee(brain));
    setSyncing(false);
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Settings" />

      <Label line>Account</Label>
      <Btn
        icon="link"
        align="left"
        label={session ? `Signed in as ${session.email}` : "Sign in or create an account"}
        onPress={() => router.push("/account")}
      />
      <Toggle
        label="Smarter reading (Amazon Bedrock)"
        hint={session ? "Captures and questions are read by Bedrock through FirstDay's AWS endpoint. Nothing is stored there." : "Sign in to turn this on. Without it, everything is read on your phone."}
        on={!!session && st.cloudAi}
        onChange={(v) => (session ? set({ cloudAi: v }) : router.push("/account"))}
      />
      {session && st.cloudAi && <Btn small kind="quiet" align="left" icon="check" label="Check it works" onPress={() => void checkCloud()} />}
      {!!cloudMsg && <Txt v="small">{cloudMsg}</Txt>}

      <Label line>Practice</Label>
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

      <Label line>Comfort</Label>
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

      <Label line>Brain (optional)</Label>
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

      {state.brain?.bee && (
        <>
          <Label line>Bee</Label>
          <Txt v="small" dim>
            {state.bee.syncedAt ? `Last synced: ${friendlyDay(state.bee.syncedAt, Date.now())}.` : "Not synced yet."}
            {state.brain.live ? " Watching live: new conversations show up on Today." : ""}
          </Txt>
          {syncing ? <ActivityIndicator color={colors.ink} /> : <Btn small icon="bee" align="left" label="Sync with Bee now" onPress={() => void syncNow()} />}
          {!!beeMsg && <Txt v="small">{beeMsg}</Txt>}
          {!!state.bee.lastError && !beeMsg && <Txt v="small">{state.bee.lastError}</Txt>}
          <Toggle
            label="Send my changes to Bee"
            hint="Kept to-dos, done to-dos, and memory fixes go back to your Bee too."
            on={st.syncToBee}
            onChange={(v) => set({ syncToBee: v })}
          />
        </>
      )}

      <Label line>Your data</Label>
      <Txt v="small" dim>Your conversations, to-dos, memories and practice live on this phone. An account is optional: it only unlocks smarter reading, and nothing you capture is stored in the cloud.</Txt>
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
