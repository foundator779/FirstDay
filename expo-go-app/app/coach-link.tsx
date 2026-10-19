import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Share, View } from "react-native";
import { useSession } from "../src/auth";
import { coachApi, coachAvailable, CoachError, MCP_URL, VOICE_PAGE_URL, type CoachToken } from "../src/coachCloud";
import { buzz } from "../src/device";
import { useStore } from "../src/store";
import { Btn, Label, Screen, Sketch, Toggle, TopBar, Txt } from "../src/ui/kit";
import { colors } from "../src/ui/theme";

type Fresh = { kind: "voice" | "agent"; token: string; link: string };

/**
 * "Quiz me from other apps": your confirmed steps power FirstDay's coach MCP server, so a voice screen
 * (say, a kitchen tablet before your shift) or any AI assistant can quiz you in your trainer's words.
 */
export default function CoachLink() {
  const { state, actions } = useStore();
  const session = useSession();
  const on = !!state.coach?.on;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tokens, setTokens] = useState<CoachToken[] | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);

  const load = () =>
    coachApi
      .tokens()
      .then(setTokens)
      .catch(() => setTokens([]));
  useEffect(() => {
    if (on && session && coachAvailable) void load();
  }, [on, !!session]);

  const toggle = async (v: boolean) => {
    setBusy(true);
    setMsg("");
    const r = await actions.setCoach(v);
    setBusy(false);
    setMsg(r.message);
    setFresh(null);
    if (r.ok && v) void load();
    if (r.ok && !v) setTokens(null);
  };

  const make = async (kind: Fresh["kind"]) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await coachApi.createToken(kind === "voice" ? "Voice screen" : "AI assistant");
      const mcp = r.mcpUrl || MCP_URL;
      setFresh({ kind, token: r.token, link: kind === "voice" ? `${VOICE_PAGE_URL}#k=${r.token}&u=${encodeURIComponent(mcp)}` : mcp });
      buzz.good();
      void load();
    } catch (e) {
      setMsg(e instanceof CoachError ? e.message : "Couldn't make a key. Try again.");
    }
    setBusy(false);
  };

  const shareFresh = (f: Fresh) => {
    const message =
      f.kind === "voice"
        ? `FirstDay voice coach (open on the screen you'll practise with): ${f.link}`
        : [
            "FirstDay coach MCP server (Streamable HTTP, spec 2025-11-25)",
            `URL: ${f.link}`,
            `Header: Authorization: Bearer ${f.token}`,
            "",
            "Claude Code:",
            `claude mcp add --transport http firstday-coach ${f.link} --header "Authorization: Bearer ${f.token}"`,
          ].join("\n");
    void Share.share({ message }).catch(() => {});
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await coachApi.revoke(id);
      void load();
    } catch (e) {
      setMsg(e instanceof CoachError ? e.message : "Couldn't remove it. Try again.");
    }
    setBusy(false);
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Quiz me anywhere" />
      <Txt dim center>
        Practise without opening FirstDay: on a voice screen before your shift, or by asking your AI assistant to quiz you. It uses only the steps you
        confirmed, in your trainer's words.
      </Txt>

      {!coachAvailable ? (
        <Txt v="small">This isn't set up in this build yet.</Txt>
      ) : !session ? (
        <Btn kind="primary" icon="link" label="Sign in first" onPress={() => router.push("/account")} />
      ) : (
        <>
          <Toggle
            label="Let other apps quiz me"
            hint="Copies your confirmed steps (and how solid each one is) to FirstDay's coach service. Turning it off deletes them and every key."
            on={on}
            onChange={(v) => void toggle(v)}
          />
          {busy && <ActivityIndicator color={colors.ink} />}
          {!!msg && <Txt v="small">{msg}</Txt>}

          {on && (
            <>
              {fresh ? (
                <Sketch seed="fresh" shadow style={{ padding: 16, gap: 10 }}>
                  <Label>{fresh.kind === "voice" ? "Your voice screen link" : "Your AI assistant key"}</Label>
                  <Txt v="small" bold>
                    {fresh.kind === "voice" ? fresh.link : `${fresh.link}\nAuthorization: Bearer ${fresh.token}`}
                  </Txt>
                  <Txt v="small" dim>
                    Shown once. Send it to yourself now; if it's lost, make a new one and remove this one.
                  </Txt>
                  <Btn kind="primary" icon="link" label="Send it to myself" onPress={() => shareFresh(fresh)} />
                  <Btn kind="quiet" label="Done" onPress={() => setFresh(null)} />
                </Sketch>
              ) : (
                <View style={{ gap: 10 }}>
                  <Btn icon="speaker" label="Make a voice screen link" disabled={busy} onPress={() => void make("voice")} />
                  <Txt v="small" dim>
                    Open it in Chrome, Edge or Safari on a tablet or laptop, tap the circle and say “Quiz me before my shift”.
                  </Txt>
                  <Btn icon="brain" label="Make a key for an AI assistant" disabled={busy} onPress={() => void make("agent")} />
                  <Txt v="small" dim>
                    Any assistant that supports remote MCP servers (Streamable HTTP) can use it. Ask it: “Quiz me on my café training.”
                  </Txt>
                </View>
              )}

              {tokens && tokens.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Label line>Apps that can quiz you</Label>
                  {tokens.map((t) => (
                    <Sketch key={t.id} seed={t.id} style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Txt>{t.label}</Txt>
                        <Txt v="tiny" dim>
                          Made {new Date(t.createdAt).toLocaleDateString()}
                        </Txt>
                      </View>
                      <Btn small kind="quiet" icon="trash" label="Remove" onPress={() => void revoke(t.id)} />
                    </Sketch>
                  ))}
                </View>
              )}
              <Txt v="tiny" dim>
                {state.coach?.pushedAt ? `Steps last sent ${new Date(state.coach.pushedAt).toLocaleString()}. ` : ""}New and changed steps are sent a few seconds after you confirm or practise them.
              </Txt>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
