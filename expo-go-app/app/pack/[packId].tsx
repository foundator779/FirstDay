import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Share, Text, View } from "react-native";
import { CoachError, coachAvailable, teamApi, type TeamPeople } from "../../src/coachCloud";
import { buzz } from "../../src/device";
import { conversationsForPack, foundLine } from "../../src/logic/conversations";
import { friendlyDay, friendlyDue } from "../../src/logic/dates";
import { packStats } from "../../src/logic/training";
import { reminderTimes } from "../../src/logic/wrist";
import type { Pack } from "../../src/logic/types";
import { useStore } from "../../src/store";
import { confirmAction } from "../../src/ui/ask";
import { Btn, Chip, Dots, Label, Marked, Quote, Screen, Sketch, Toggle, TopBar, Txt } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

/**
 * Trainer: who asked to join (verified email and the name they gave) with Let in / Decline, and who's in, with Remove.
 * Loads when the training opens; nobody gets the steps until they're let in.
 */
function TeamPeoplePanel({ code, onChange }: { code: string; onChange: () => void }) {
  const [people, setPeople] = useState<TeamPeople | null>(null);
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try {
      setPeople(await teamApi.people(code));
      setMsg("");
    } catch (e) {
      setMsg(e instanceof CoachError ? e.message : "Couldn't load your team.");
    }
  }, [code]);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, action: "approve" | "decline" | "remove") => {
    setBusyId(id);
    setMsg("");
    try {
      setPeople(await teamApi.decide(code, id, action));
      if (action === "approve") buzz.good();
      onChange();
    } catch (e) {
      setMsg(e instanceof CoachError ? e.message : "Something went wrong. Try again.");
      void load();
    }
    setBusyId("");
  };
  const who = (p: { email: string; name?: string }) => (p.name ? `${p.name} · ${p.email}` : p.email);
  const setOpen = async (open: boolean) => {
    setBusyId("open");
    setMsg("");
    try {
      setPeople(await teamApi.setOpen(code, open));
      onChange();
    } catch (e) {
      setMsg(e instanceof CoachError ? e.message : "Something went wrong. Try again.");
    }
    setBusyId("");
  };

  return (
    <View style={{ gap: 8 }}>
      {people && (
        <Toggle
          label="Let anyone with the code in"
          hint={
            people.open
              ? "On: people join right away. You still see who joined and can remove anyone. Good for a practice team."
              : "Off: you let in each person who asks."
          }
          on={people.open}
          onChange={(v) => {
            if (busyId) return;
            if (v && people.requests.length > 0) {
              confirmAction("Let everyone in?", `Turning this on also lets in the ${people.requests.length} ${people.requests.length === 1 ? "person" : "people"} waiting.`, "Turn on", () => void setOpen(true));
            } else void setOpen(v);
          }}
        />
      )}
      {people && people.requests.length > 0 && (
        <>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1 }}>
            WANTS TO JOIN
          </Txt>
          {people.requests.map((p) => (
            <Sketch key={p.id} seed={`req-${p.id}`} fill={colors.highlightSoft} style={{ padding: 12, gap: 8 }}>
              <Txt bold numberOfLines={2}>
                {who(p)}
              </Txt>
              {busyId === p.id ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Btn small kind="primary" style={{ flex: 1 }} icon="check" label="Let in" onPress={() => void decide(p.id, "approve")} />
                  <Btn small style={{ flex: 1 }} label="Decline" onPress={() => void decide(p.id, "decline")} />
                </View>
              )}
            </Sketch>
          ))}
        </>
      )}
      {people && (
        <>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1 }}>
            ON YOUR TEAM
          </Txt>
          {people.members.length === 0 ? (
            <Txt v="small" dim>
              {people.open ? "Nobody yet. Share the code; people join right away." : "Nobody yet. Share the code; you'll let each person in here."}
            </Txt>
          ) : (
            people.members.map((p) => (
              <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Txt v="small" style={{ flex: 1 }} numberOfLines={1}>
                  {who(p)}
                </Txt>
                {busyId === p.id ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Btn
                    kind="quiet"
                    label="Remove"
                    onPress={() =>
                      confirmAction("Remove from the team?", `${p.name ?? p.email} keeps their copy but won't get your changes anymore.`, "Remove", () => void decide(p.id, "remove"))
                    }
                  />
                )}
              </View>
            ))
          )}
          <Btn kind="quiet" align="left" icon="refresh" label="Check for new requests" onPress={() => void load()} />
        </>
      )}
      {!people && !msg && <ActivityIndicator color={colors.ink} />}
      {!!msg && <Txt v="small">{msg}</Txt>}
    </View>
  );
}

/** A practice reminder before your next shift: a notification on this phone, cleared once the steps are practised. */
function WristPanel({ pack }: { pack: Pack }) {
  const { state, actions } = useStore();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const r = pack.reminder;
  if (!pack.rules.length) return null;
  const pick = async (at: number) => {
    setBusy(true);
    setMsg("");
    const res = await actions.remindPractice(pack.id, at);
    setBusy(false);
    setPicking(false);
    setMsg(res.message);
    if (res.ok) buzz.good();
  };
  const all = r && r.ruleIds.length === 1 ? "that step" : `all ${r?.ruleIds.length ?? 0} steps`;
  return (
    <View style={{ gap: 8 }}>
      <Label line>Practice reminder</Label>
      <Sketch seed="wrist" fill={colors.wash} style={{ padding: 14, gap: 10 }}>
        <Txt v="small">
          {r
            ? `${r.kind === "change" ? `${pack.trainer}'s change` : "Practice reminder"} ${r.via === "bee" ? "is in Bee" : "is set on this phone"} for ${friendlyDue(r.at, Date.now())}. It's cleared when you've practised ${all}.`
            : `Get a reminder on this phone before your next shift: “Practise ${pack.title}”.`}
        </Txt>
        {busy ? (
          <ActivityIndicator color={colors.ink} />
        ) : picking ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {reminderTimes(Date.now()).map((t) => (
              <Chip key={t.label} label={t.label} on={false} onPress={() => void pick(t.at)} />
            ))}
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Btn small style={{ flex: 1 }} icon="timer" label={r ? "Change the time" : "Remind me"} onPress={() => setPicking(true)} />
            {r && (
              <Btn
                small
                kind="quiet"
                label="Remove"
                onPress={() =>
                  void actions.cancelPracticeReminder(pack.id).then(() => setMsg(r.via === "bee" ? "Removed. It's checked off in Bee." : "Removed."))
                }
              />
            )}
          </View>
        )}
        {!!msg && <Txt v="small">{msg}</Txt>}
      </Sketch>
    </View>
  );
}

/** Sharing with a team (trainer) or the link back to the team (trainee). */
function TeamPanel({ pack }: { pack: Pack }) {
  const { actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setMsg("");
    const r = await fn();
    setBusy(false);
    setMsg(r.message);
    if (r.ok) buzz.good();
  };
  const team = pack.team;
  const shareCode = (code: string) =>
    void Share.share({ message: `Join my training "${pack.title}" in FirstDay Go: open the app, tap Join my team's training, and type ${code}. ${pack.team?.open ? "You're in right away." : "I'll let you in."} (firstdaygo://join?code=${code})` }).catch(() => {});

  if (!coachAvailable && !team) return null;
  return (
    <View style={{ gap: 8 }}>
      <Label line>{team?.role === "trainee" ? "Your team" : "Share with your team"}</Label>
      {!team ? (
        <Sketch seed="team-share" dashed fill={colors.wash} style={{ padding: 16, gap: 10 }}>
          <Txt v="small">
            Training someone, or coaching a new hire? Share this training. They practise every step in {pack.trainer === "Your trainer" ? "the trainer's" : `${pack.trainer}'s`} words,
            and when a step changes, they get a Change Drill. You get a code to give them, and you let in each person who asks.
          </Txt>
          {busy ? <ActivityIndicator color={colors.ink} /> : <Btn small icon="link" label="Share with my team" onPress={() => void run(() => actions.shareTeam(pack.id))} />}
        </Sketch>
      ) : team.role === "trainer" ? (
        <Sketch seed="team-trainer" shadow style={{ padding: 16, gap: 10 }}>
          <Txt v="tiny" dim bold style={{ letterSpacing: 1 }}>
            JOIN CODE
          </Txt>
          <Text accessibilityLabel={`Join code ${team.code.split("").join(" ")}`} style={{ fontFamily: fonts.bodyBold, fontSize: 34, letterSpacing: 8, color: colors.ink }}>
            {team.code}
          </Text>
          <Txt v="small" dim>
            {team.members ?? 0} {team.members === 1 ? "person" : "people"} on the team · version {team.version}
          </Txt>
          <TeamPeoplePanel code={team.code} onChange={() => void actions.checkTeams()} />
          {team.dirty && (
            <Txt v="small" bold>
              You changed steps since your last send. Your team still has the old version.
            </Txt>
          )}
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <>
              {team.dirty && <Btn kind="primary" icon="refresh" label="Send my changes to the team" onPress={() => void run(() => actions.sendTeamUpdate(pack.id))} />}
              <Btn small icon="link" label="Share the code" onPress={() => shareCode(team.code)} />
              <Btn
                kind="quiet"
                align="left"
                label="Stop sharing"
                onPress={() =>
                  confirmAction("Stop sharing?", "Your team keeps their copies, but won't get your changes anymore.", "Stop sharing", () => void run(() => actions.leaveTeam(pack.id)))
                }
              />
            </>
          )}
          <Txt v="tiny" dim>
            To change a step, record or paste what you'd tell them, then add it to this training. Nothing reaches your team until you send it.
          </Txt>
        </Sketch>
      ) : (
        <Sketch seed="team-trainee" fill={colors.wash} style={{ padding: 16, gap: 8 }}>
          <Txt v="small">
            {team.removed
              ? `${pack.trainer} removed you from this team. Your copy stays yours, without updates.`
              : team.stopped
              ? `${pack.trainer} stopped sharing this training. Your copy stays yours.`
              : `From ${pack.trainer}'s team. When ${pack.trainer} changes a step, you'll get a Change Drill here.`}
          </Txt>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            !team.stopped && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Btn
                  small
                  style={{ flex: 1 }}
                  icon="refresh"
                  label="Check for changes"
                  onPress={() =>
                    void run(async () => {
                      const n = await actions.checkTeams();
                      return n < 0 ? { ok: false, message: "Couldn't check. Are you online and signed in?" } : { ok: true, message: n ? "Updated." : "You're up to date." };
                    })
                  }
                />
                <Btn small style={{ flex: 1 }} label="Leave team" onPress={() => void run(() => actions.leaveTeam(pack.id))} />
              </View>
            )
          )}
        </Sketch>
      )}
      {!!msg && <Txt v="small">{msg}</Txt>}
    </View>
  );
}

export default function PackScreen() {
  const { packId } = useLocalSearchParams<{ packId: string }>();
  const { state, actions } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const pack = state.packs.find((p) => p.id === packId);
  if (!pack) {
    return (
      <Screen footer={<Btn kind="primary" label="Back" onPress={() => router.back()} />}>
        <Txt>This training was deleted.</Txt>
      </Screen>
    );
  }
  const st = packStats(pack, state.progress, Date.now());
  const mode = st.seen < st.total ? "learn" : "review";
  const questions = state.questions.filter((q) => q.packId === pack.id && !q.askedAt);
  const sources = conversationsForPack(state, pack.id);

  return (
    <Screen
      footer={
        <>
          {pack.pendingUpdates.length > 0 && st.seen === st.total && (
            <Btn kind="primary" icon="refresh" label="See what changed" onPress={() => router.push(`/session/${pack.id}?mode=change`)} />
          )}
          <Btn kind={pack.pendingUpdates.length > 0 && st.seen === st.total ? "plain" : "primary"} icon="play" label={mode === "learn" ? "Learn" : "Practise"} onPress={() => router.push(`/session/${pack.id}?mode=${mode}`)} />
        </>
      }
    >
      <TopBar onBack={() => router.back()} />
      <Txt v="title">{pack.title}</Txt>
      <Txt dim>
        From {pack.trainer}
        {pack.sample ? " · fictional sample" : ""}
      </Txt>
      <Dots total={st.total} done={st.seen} />
      <Txt v="small" dim>
        {st.seen}/{st.total} learned · {st.solid} solid{st.due ? ` · ${st.due} due now` : ""}
      </Txt>

      <Label line>Steps</Label>
      {pack.rules.map((r) => {
        const level = state.progress[r.id]?.level ?? 0;
        return (
          <Pressable key={r.id} accessibilityRole="button" accessibilityHint="Shows the source quote" onPress={() => setOpen(open === r.id ? null : r.id)}>
            <Sketch seed={r.id} style={{ padding: 14, gap: 6 }}>
              <Txt v="small" dim>
                {r.situation}
              </Txt>
              <Marked text={r.action} keywords={r.keywords} />
              <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                {[1, 2, 3, 4].map((n) => (
                  <View key={n} style={{ width: 18, height: 5, borderRadius: 3, backgroundColor: n <= level ? colors.ink : colors.faint }} />
                ))}
                <Txt v="tiny" dim>
                  {"  "}
                  {r.changedFrom ? "updated" : ""}
                </Txt>
              </View>
              {open === r.id && <Quote who={pack.trainer} text={r.quote} />}
            </Sketch>
          </Pressable>
        );
      })}

      {questions.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label line>{`Ask ${pack.trainer === "Your trainer" ? "your trainer" : pack.trainer}`}</Label>
          {questions.map((q) => (
            <Sketch key={q.id} seed={q.id} dashed fill={colors.wash} style={{ padding: 12, gap: 6 }}>
              <Txt v="small">{q.text}</Txt>
              <Btn kind="quiet" align="left" icon="check" label="I asked" onPress={() => actions.markAsked(q.id)} />
            </Sketch>
          ))}
        </View>
      )}

      <WristPanel pack={pack} />

      <TeamPanel pack={pack} />

      {sources.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Label line>Where this came from</Label>
          {sources.map((r) => (
            <Pressable key={r.convo.id} accessibilityRole="button" accessibilityLabel={`Open ${r.convo.title}`} onPress={() => router.push(`/convo/${r.convo.id}`)}>
              <Sketch seed={`src-${r.convo.id}`} style={{ padding: 12, gap: 2 }}>
                <Txt v="small" numberOfLines={2}>
                  {r.convo.title}
                </Txt>
                <Txt v="tiny" dim>
                  {friendlyDay(r.convo.at, Date.now())}
                  {r.convo.source === "bee" ? " · from Bee" : ""} · {foundLine(r)}
                </Txt>
              </Sketch>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <Btn kind="quiet" align="left" label={showSource ? "Hide the source conversation" : "Show the source conversation"} onPress={() => setShowSource(!showSource)} />
          {showSource && (
            <Sketch seed="src" style={{ padding: 14 }}>
              <Txt v="small">{pack.source || "No source text saved."}</Txt>
            </Sketch>
          )}
        </>
      )}

      <View style={{ flexDirection: "row", gap: 16 }}>
        <Btn kind="quiet" icon="refresh" label="Start over" onPress={() => actions.resetPack(pack.id)} />
        <Btn
          kind="quiet"
          icon="trash"
          label="Delete"
          onPress={() =>
            confirmAction(
              "Delete this training?",
              pack.team?.role === "trainer" ? "Its practice history goes too, and your team stops getting changes." : pack.team ? "Its practice history goes too, and you leave the team." : "Its practice history goes too. The conversations it came from stay in More → Conversations.",
              "Delete",
              () => {
                actions.deletePack(pack.id);
                router.back();
              },
            )
          }
        />
      </View>
    </Screen>
  );
}
