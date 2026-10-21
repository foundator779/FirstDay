import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { beeCloudApi, BeeCloudError, beeCloudAvailable, cloudBeeBrain, type BeeConnection } from "../src/beeCloud";
import { friendlyDay } from "../src/logic/dates";
import { useStore } from "../src/store";
import { appAlert } from "../src/ui/dialog";
import { Btn, CheckBox, Label, Screen, Sketch, TopBar, Txt } from "../src/ui/kit";
import { colors } from "../src/ui/theme";

type Step = "loading" | "consent" | "approve" | "connected" | "closed";

/** Plain-language terms shown before connecting. Keep in step with BEE_CONSENT_VERSION. */
const TERMS = [
  "First, turn on Developer Mode in the Bee app: Settings → tap Version 5 times.",
  "FirstDay's server then signs in to your Bee account with Bee's own developer tool. It can read your Bee conversations, facts, to-dos, daily summaries and insights, and save the changes you make here back to Bee.",
  "Your Bee sign-in is stored encrypted on FirstDay's AWS. The key that opens it stays on this phone, so it's only used while this app asks.",
  "FirstDay still only opens a conversation's transcript after you OK that conversation.",
  "Disconnect any time: FirstDay signs out of Bee and deletes everything it stored for you.",
  "This is a preview, not an official Bee feature. Bee's privacy promise covers Bee's own apps; once you connect, FirstDay can see what's listed above.",
];

/**
 * Connect Bee without a computer (preview). FirstDay's Bee service runs Bee's CLI in AWS: you agree to
 * the terms, approve Bee's sign-in link, and your Bee data syncs like it does through the brain.
 */
export default function BeeConnect() {
  const { state, actions } = useStore();
  const [step, setStep] = useState<Step>("loading");
  const [conn, setConn] = useState<BeeConnection | null>(null);
  const [agree, setAgree] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [accountId, setAccountId] = useState("");
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (polling.current) clearInterval(polling.current);
    polling.current = null;
  };
  useEffect(() => stopPolling, []);

  const explain = (e: unknown) => {
    if (e instanceof BeeCloudError) {
      if (e.status === 403) {
        setAccountId(String(e.detail.accountId ?? ""));
        setStep("closed");
      }
      if (e.detail.code === "key-mismatch") return "This phone can't open your saved Bee connection (it was made on another phone, or the app was reinstalled). Disconnect, then connect again.";
      return e.message;
    }
    return "Couldn't reach FirstDay's Bee service. Check your connection and try again.";
  };

  const finishConnected = async () => {
    stopPolling();
    actions.setBrain(cloudBeeBrain);
    setStep("connected");
    setMsg("Connected. Syncing your Bee data…");
    setMsg(await actions.syncBee(cloudBeeBrain));
  };

  useEffect(() => {
    if (!beeCloudAvailable) return;
    void (async () => {
      try {
        const c = await beeCloudApi.connection();
        setConn(c);
        if (c.status === "connected" && !c.needsConsent) {
          if (!state.brain?.cloudBee) actions.setBrain(cloudBeeBrain);
          setStep("connected");
        } else setStep("consent");
      } catch (e) {
        setMsg(explain(e));
        setStep((s) => (s === "loading" ? "consent" : s));
      }
    })();
  }, []);

  const start = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await beeCloudApi.start();
      setLink(r.link);
      setStep("approve");
      void Linking.openURL(r.link).catch(() => {});
      // Check every 6 s while you approve in Bee (Bee's link is good for about 5 minutes).
      stopPolling();
      const started = Date.now();
      polling.current = setInterval(() => {
        if (Date.now() - started > 15 * 60_000) return stopPolling();
        void beeCloudApi
          .check()
          .then((c) => (c.status === "connected" ? finishConnected() : undefined))
          .catch(() => {});
      }, 6000);
    } catch (e) {
      setMsg(explain(e));
    }
    setBusy(false);
  };

  const checkNow = async () => {
    setBusy(true);
    try {
      const c = await beeCloudApi.check();
      if (c.status === "connected") await finishConnected();
      else setMsg("Not approved yet. Open the link, approve FirstDay in Bee, then tap again.");
    } catch (e) {
      setMsg(explain(e));
    }
    setBusy(false);
  };

  const disconnect = () =>
    appAlert("Disconnect Bee?", "FirstDay signs out of Bee and deletes your Bee sign-in from its server. What's already on this phone stays.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusy(true);
            stopPolling();
            try {
              await beeCloudApi.disconnect();
              setMsg("Disconnected. Your Bee sign-in was deleted from FirstDay's server.");
            } catch (e) {
              setMsg(explain(e));
            }
            if (state.brain?.cloudBee) actions.setBrain(null);
            setAgree(false);
            setStep("consent");
            setBusy(false);
          })(),
      },
    ]);

  if (!beeCloudAvailable) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} title="Connect Bee" />
        <Txt dim>Connecting Bee without a computer isn't switched on in this build.</Txt>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        step === "consent" ? (
          busy ? <ActivityIndicator color={colors.ink} /> : <Btn kind="primary" icon="link" label="Agree and connect Bee" disabled={!agree} onPress={() => void start()} />
        ) : step === "approve" ? (
          <>
            <Btn kind="primary" icon="link" label="Open Bee's approval link" onPress={() => void Linking.openURL(link).catch(() => {})} />
            {busy ? <ActivityIndicator color={colors.ink} /> : <Btn label="I've approved it" icon="check" onPress={() => void checkNow()} />}
          </>
        ) : step === "connected" ? (
          busy ? <ActivityIndicator color={colors.ink} /> : <Btn label="Disconnect Bee" icon="close" onPress={disconnect} />
        ) : undefined
      }
    >
      <TopBar onBack={() => router.back()} title="Connect Bee" sub="Preview · no computer needed" />

      {step === "loading" && <ActivityIndicator color={colors.ink} />}

      {step === "closed" && (
        <Sketch seed="bee-closed" dashed fill={colors.wash} style={{ padding: 16, gap: 8 }}>
          <Txt>Connecting Bee without a computer is a preview that's only open to allowed accounts for now.</Txt>
          {!!accountId && (
            <Txt v="small" dim>
              Your FirstDay account ID: {accountId}
            </Txt>
          )}
          <Txt v="small" dim>
            Meanwhile, the FirstDay helper on a computer connects Bee too (Settings → Brain).
          </Txt>
        </Sketch>
      )}

      {step === "consent" && (
        <>
          <Txt v="h2">Before you connect</Txt>
          <Sketch seed="bee-terms" style={{ padding: 16, gap: 12 }}>
            {TERMS.map((t, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                <Txt bold>{i + 1}.</Txt>
                <Txt style={{ flex: 1 }}>{t}</Txt>
              </View>
            ))}
          </Sketch>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <CheckBox label="I understand and agree" on={agree} onPress={() => setAgree(!agree)} />
            <Txt style={{ flex: 1 }}>I understand what FirstDay can access and agree to connect my Bee account.</Txt>
          </View>
          {conn?.needsConsent && <Txt v="small">The terms changed since you connected. Please read and agree again.</Txt>}
        </>
      )}

      {step === "approve" && (
        <>
          <Txt v="h2">Approve FirstDay in Bee</Txt>
          <Txt>Bee's sign-in page opened. Approve the request there, then come back. This screen checks every few seconds.</Txt>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={colors.ink} />
            <Txt v="small" dim>
              Waiting for your approval…
            </Txt>
          </View>
          <Label>Link</Label>
          <Txt v="small" dim>
            {link}
          </Txt>
        </>
      )}

      {step === "connected" && (
        <Sketch seed="bee-ok" fill={colors.ink} radius={24} style={{ padding: 20, gap: 8 }}>
          <Txt v="h2">Bee is connected</Txt>
          <Txt dim>
            {conn?.connectedAt ? `Since ${friendlyDay(conn.connectedAt, Date.now())}. ` : ""}Your Bee data syncs while FirstDay is open, from anywhere. No computer needed.
          </Txt>
          <Btn kind="primary" icon="refresh" label="Sync now" onPress={() => void actions.syncBee(cloudBeeBrain).then(setMsg)} />
        </Sketch>
      )}

      {!!msg && <Txt v="small">{msg}</Txt>}
    </Screen>
  );
}
