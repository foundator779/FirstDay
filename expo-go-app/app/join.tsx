import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, TextInput } from "react-native";
import { useSession } from "../src/auth";
import { coachAvailable } from "../src/coachCloud";
import { buzz } from "../src/device";
import { normalizeCode, validCode } from "../src/logic/team";
import { useStore } from "../src/store";
import { Btn, Label, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

/**
 * Ask to join a training your trainer (or job coach) shared. Opened from Train, More, or a firstdaygo://join?code=… link.
 * The trainer sees your email and the name you give, and lets you in; only then do the steps arrive.
 */
export default function Join() {
  const params = useLocalSearchParams<{ code?: string }>();
  const { state, actions } = useStore();
  const session = useSession();
  const { s } = useUI();
  const [code, setCode] = useState(normalizeCode(params.code ?? ""));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [askedCode, setAskedCode] = useState("");
  const asked = state.teamRequests.find((r) => r.code === askedCode);
  // Let in while this screen is open: the training is already in Train.
  const inNow = askedCode && !asked ? state.packs.find((p) => p.team?.code === askedCode) : undefined;

  const join = async () => {
    setBusy(true);
    setMsg("");
    const r = await actions.joinTeam(code, name);
    setBusy(false);
    if (r.ok && r.pending) {
      buzz.good();
      setAskedCode(code);
    } else if (r.ok && r.packId) {
      buzz.good();
      router.replace(`/pack/${r.packId}`);
    } else setMsg(r.message);
  };

  const checkNow = async () => {
    setBusy(true);
    setMsg("");
    const n = await actions.checkTeams();
    setBusy(false);
    if (n < 0) setMsg("Couldn't check. Are you online?");
  };

  if (askedCode && (asked || inNow)) {
    const trainer = asked?.trainer ?? inNow?.trainer ?? "Your trainer";
    const title = asked?.title ?? inNow?.title ?? "the training";
    return (
      <Screen
        footer={
          busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : inNow ? (
            <Btn kind="primary" icon="play" label={`Open ${inNow.title}`} onPress={() => router.replace(`/pack/${inNow.id}`)} />
          ) : asked?.status === "declined" ? (
            <Btn kind="primary" label="OK" onPress={() => void actions.cancelTeamRequest(askedCode).then(() => router.back())} />
          ) : (
            <>
              <Btn kind="primary" icon="refresh" label="Check now" onPress={() => void checkNow()} />
              <Btn label="Done" onPress={() => router.back()} />
            </>
          )
        }
      >
        <TopBar onBack={() => router.back()} close title="Join a team" />
        <Sketch seed="join-wait" shadow style={{ padding: 18, gap: 10 }}>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1 }}>
            {title.toUpperCase()}
          </Txt>
          <Txt v="h2">
            {inNow ? `${trainer} let you in.` : asked?.status === "declined" ? `${trainer} didn't let you in.` : `Waiting for ${trainer} to let you in`}
          </Txt>
          <Txt v="small" dim>
            {inNow
              ? "Every step is ready to practise, in their exact words."
              : asked?.status === "declined"
                ? "Check the code with them, or ask them to look for your request."
                : `${trainer} sees your request with your email${name.trim() ? ` and the name "${name.trim()}"` : ""}. As soon as they tap Let in, the training appears under Train. You can close this screen.`}
          </Txt>
        </Sketch>
        {!!msg && <Txt v="small">{msg}</Txt>}
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        busy ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Btn kind="primary" icon="check" label="Ask to join" disabled={!coachAvailable || !validCode(code)} onPress={() => void join()} />
        )
      }
    >
      <TopBar onBack={() => router.back()} close title="Join a team" />
      <Txt v="h2">Type the code your trainer gave you</Txt>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(normalizeCode(t))}
        placeholder="K7P2QX"
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={8}
        accessibilityLabel="Join code"
        style={{ fontFamily: fonts.bodyBold, fontSize: s.hero + 8, letterSpacing: 8, textAlign: "center", color: colors.ink, borderBottomWidth: 2, borderBottomColor: colors.ink, paddingVertical: 12 }}
      />
      <Label>Your name (so your trainer knows it's you)</Label>
      <Sketch seed="join-name" style={{ minHeight: 52, justifyContent: "center" }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Sam"
          placeholderTextColor={colors.pencil}
          autoCapitalize="words"
          maxLength={40}
          accessibilityLabel="Your name"
          style={{ fontFamily: fonts.body, fontSize: s.body + 1, color: colors.ink, paddingVertical: 12, paddingHorizontal: 14 }}
        />
      </Sketch>
      {!!msg && (
        <Sketch seed="join-msg" fill={colors.highlightSoft} style={{ padding: 12 }}>
          <Txt v="small" bold>
            {msg}
          </Txt>
        </Sketch>
      )}
      <Sketch seed="join-how" dashed fill={colors.wash} style={{ padding: 14, gap: 6 }}>
        <Txt v="small">Your trainer gets your request and lets you in. Then you get every step in their exact words, ready to practise.</Txt>
        <Txt v="small">When they change a step later, you get a Change Drill: old vs. new, then the new way.</Txt>
        <Txt v="small" dim>
          Your trainer sees your email{session?.email ? ` (${session.email})` : ""} and the name you give, never your answers.
        </Txt>
      </Sketch>
      {!coachAvailable && <Txt v="small">Team trainings aren't set up in this build yet.</Txt>}
    </Screen>
  );
}
