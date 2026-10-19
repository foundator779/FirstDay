// FirstDay's coach service (infra/coach.yaml, deployed with infra/deploy-coach.sh): one Lambda Function
// URL and one on-demand DynamoDB table, pay per use. It does two things:
//  1. Team trainings: a trainer shares a training with a join code and lets in each person who asks;
//     changes reach every member.
//  2. "Use my trainings in other apps": a remote MCP server (spec 2025-11-25, Streamable HTTP) that any
//     agent, and FirstDay's voice screen, can use to quiz you on the steps you confirmed.
// Every call carries the signed-in account's Amazon Cognito access token.
import { getAccessToken, getIdToken } from "./auth";
import { cleanRemote, type RemoteTeam, type WireRule } from "./logic/team";

/** Override with EXPO_PUBLIC_FIRSTDAY_COACH_URL (for your own deployment of infra/coach.yaml). */
const DEFAULT_URL = "https://xexduccr223pex3iuq4lqe5kfe0utyxs.lambda-url.us-east-1.on.aws";
export const COACH_URL = (process.env.EXPO_PUBLIC_FIRSTDAY_COACH_URL || DEFAULT_URL).trim().replace(/\/+$/, "");
export const coachAvailable = COACH_URL.length > 0;
/** The hosted voice screen (public/voice.html in the web build). */
export const VOICE_PAGE_URL = (process.env.EXPO_PUBLIC_FIRSTDAY_VOICE_URL || "https://d1ypavau8ae868.cloudfront.net/voice.html").trim();

export class CoachError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  if (!coachAvailable) throw new CoachError("Team sharing isn't set up in this build yet.", 503, "not-configured");
  const token = await getAccessToken().catch(() => undefined);
  if (!token) throw new CoachError("Sign in first.", 401, "sign-in");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${COACH_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new CoachError(typeof json.error === "string" ? json.error : `Request failed (${res.status})`, res.status, typeof json.code === "string" ? json.code : undefined);
    return json as T;
  } catch (e) {
    if (e instanceof CoachError) throw e;
    throw new CoachError("Couldn't reach FirstDay's coach service. Check your connection.", 0, "network");
  } finally {
    clearTimeout(timer);
  }
}

const team = (raw: unknown): RemoteTeam => {
  const t = cleanRemote(raw);
  if (!t) throw new CoachError("The coach service sent something unexpected.", 502, "bad-reply");
  return t;
};

type PackBody = { title: string; trainer: string; place: string; rules: WireRule[]; questions: string[] };
/** Your link to a shared training. pending: you asked and the trainer hasn't decided; declined or removed: the trainer said no. */
export type TeamRole = "trainer" | "trainee" | "pending" | "declined" | "removed";
export type MyTeam = { code: string; role: TeamRole; version: number; members: number; requests?: number; open?: boolean; title?: string; trainer?: string; gone?: boolean };
/** Someone who asked to join, or who is on the team: the email Cognito verified, and the name they gave. */
export type TeamPerson = { id: string; email: string; name?: string; at: number };
/** open: "Let anyone with the code in" is on, so people join right away (the trainer still sees them and can remove them). */
export type TeamPeople = { requests: TeamPerson[]; members: TeamPerson[]; open: boolean };
export type JoinResult = { status: "member"; team: RemoteTeam } | { status: "pending"; title: string; trainer: string };

const text = (v: unknown) => (typeof v === "string" ? v : "");
const ROLES: TeamRole[] = ["trainer", "trainee", "pending", "declined", "removed"];
function peopleFrom(raw: unknown): TeamPeople {
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown): TeamPerson[] =>
    (Array.isArray(v) ? v : []).flatMap((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      if (!text(p.id) || !text(p.email)) return [];
      return [{ id: text(p.id), email: text(p.email), ...(text(p.name) ? { name: text(p.name) } : {}), at: Number(p.at) || 0 }];
    });
  return { requests: list(o.requests), members: list(o.members), open: o.open === true };
}

export const teamApi = {
  /** Share a training. You become its trainer. */
  async create(pack: PackBody): Promise<RemoteTeam> {
    return team(await call("POST", "/teams", { pack }));
  },
  /** Send your latest version. Returns what changed for the team. */
  async publish(code: string, pack: PackBody): Promise<RemoteTeam & { changed: number; added: number; removed: number }> {
    const r = await call<Record<string, unknown>>("PUT", `/teams/${code}`, { pack });
    return { ...team(r), changed: Number(r.changed) || 0, added: Number(r.added) || 0, removed: Number(r.removed) || 0 };
  },
  /**
   * Ask to join. The trainer sees your verified email (from your Cognito ID token) and the name you give,
   * and lets you in. Until then you get the training's name only.
   */
  async join(code: string, name: string): Promise<JoinResult> {
    const idToken = await getIdToken().catch(() => undefined);
    if (!idToken) throw new CoachError("Sign in first.", 401, "sign-in");
    const r = await call<Record<string, unknown>>("POST", `/teams/${code}/join`, { idToken, name: name.trim().slice(0, 40) });
    if (r.status === "pending") return { status: "pending", title: text(r.title) || "Team training", trainer: text(r.trainer) || "Your trainer" };
    return { status: "member", team: team(r) };
  },
  async get(code: string): Promise<RemoteTeam> {
    return team(await call("GET", `/teams/${code}`));
  },
  async mine(): Promise<MyTeam[]> {
    const r = await call<{ teams?: unknown[] }>("GET", "/me/teams");
    return (Array.isArray(r.teams) ? r.teams : []).flatMap((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const code = text(o.code);
      const role = ROLES.find((k) => k === o.role);
      if (!code || !role) return [];
      return [{
        code, role, version: Number(o.version) || 0, members: Number(o.members) || 0,
        ...(role === "trainer" ? { requests: Number(o.requests) || 0, open: o.open === true } : {}),
        ...(text(o.title) ? { title: text(o.title) } : {}), ...(text(o.trainer) ? { trainer: text(o.trainer) } : {}),
        ...(o.gone === true ? { gone: true } : {}),
      }];
    });
  },
  /** Trainer only: who's waiting and who's in. */
  async people(code: string): Promise<TeamPeople> {
    return peopleFrom(await call("GET", `/teams/${code}/people`));
  },
  /** Trainer only: let someone in, decline them, or remove a member. Returns the updated lists. */
  async decide(code: string, id: string, action: "approve" | "decline" | "remove"): Promise<TeamPeople> {
    return peopleFrom(await call("POST", `/teams/${code}/people/${encodeURIComponent(id)}/${action}`, {}));
  },
  /** Trainer only: "Let anyone with the code in". Turning it on also lets in everyone who is waiting. */
  async setOpen(code: string, open: boolean): Promise<TeamPeople> {
    return peopleFrom(await call("POST", `/teams/${code}/settings`, { open }));
  },
  /** Leave a training, or take back a request that's still waiting. */
  leave: (code: string) => call<{ ok: boolean }>("POST", `/teams/${code}/leave`, {}),
  stop: (code: string) => call<{ ok: boolean }>("DELETE", `/teams/${code}`),
};

export type CoachToken = { id: string; label: string; createdAt: number };

export const coachApi = {
  /** Your confirmed rules (with practice levels) and open trainer questions, for the MCP server. */
  putPacks: (packs: unknown[], questions: string[]) => call<{ ok: boolean }>("PUT", "/coach/packs", { packs, questions }),
  /** A new key for one app. The key is shown once; only a hash is kept. */
  createToken: (label: string) => call<{ id: string; token: string; mcpUrl: string }>("POST", "/coach/tokens", { label }),
  async tokens(): Promise<CoachToken[]> {
    const r = await call<{ tokens?: CoachToken[] }>("GET", "/coach/tokens");
    return Array.isArray(r.tokens) ? r.tokens : [];
  },
  revoke: (id: string) => call<{ ok: boolean }>("DELETE", `/coach/tokens/${encodeURIComponent(id)}`),
  /** Turns it off: deletes your rules and every key from the service. */
  off: () => call<{ ok: boolean }>("DELETE", "/coach"),
};

export const MCP_URL = coachAvailable ? `${COACH_URL}/mcp` : "";
