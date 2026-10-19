// Team trainings: a trainer (or job coach) shares a training with a join code; trainees get the same
// steps with the trainer's exact words. When the trainer changes a step, each trainee who already
// practised it gets a Change Drill; steps they haven't practised yet simply update.
// Pure functions, so the rules are tested without a phone or a network.
import { keywordsFor } from "./text";
import type { AppState, Pack, Rule, RuleUpdate } from "./types";

/** A step as it travels to and from the coach service. */
export type WireRule = {
  id: string;
  situation: string;
  action: string;
  quote: string;
  keywords?: string[];
  customerLine?: string;
  distractors?: string[];
};

/** A shared training as the coach service returns it. */
export type RemoteTeam = {
  code: string;
  title: string;
  trainer: string;
  place: string;
  version: number;
  rules: WireRule[];
  questions: string[];
  members?: number;
};

/** Join codes: 6 characters, no look-alikes (0/O, 1/I/L). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
export const validCode = (code: string) => code.length === 6 && [...code].every((c) => CODE_ALPHABET.includes(c));

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The pack in the shape the service stores: no practice data, no old actions. */
export function toWire(pack: Pack): { title: string; trainer: string; place: string; rules: WireRule[]; questions: string[] } {
  return {
    title: pack.title,
    trainer: pack.trainer,
    place: pack.place,
    questions: pack.questions,
    rules: pack.rules.map((r) => ({
      id: r.id,
      situation: r.situation,
      action: r.action,
      quote: r.quote,
      keywords: r.keywords,
      ...(r.customerLine ? { customerLine: r.customerLine } : {}),
      ...(r.distractors?.length ? { distractors: r.distractors } : {}),
    })),
  };
}

function ruleFromWire(w: WireRule): Rule {
  return {
    id: w.id,
    situation: w.situation,
    action: w.action,
    quote: w.quote,
    keywords: w.keywords?.length ? w.keywords : keywordsFor(w.action),
    ...(w.customerLine ? { customerLine: w.customerLine } : {}),
    ...(w.distractors?.length ? { distractors: w.distractors } : {}),
  };
}

/** A trainee's copy of a shared training, right after joining. */
export function packFromTeam(remote: RemoteTeam, now: number): Pack {
  return {
    id: `team-${remote.code}`,
    title: remote.title,
    place: remote.place,
    trainer: remote.trainer || "Your trainer",
    sample: false,
    createdAt: now,
    source: "",
    rules: remote.rules.map(ruleFromWire),
    questions: remote.questions,
    pendingUpdates: [],
    team: { code: remote.code, role: "trainee", version: remote.version, syncedAt: now, ruleIds: remote.rules.map((r) => r.id) },
  };
}

export type TeamUpdateResult = { pack: Pack; drills: number; quiet: number; added: number; removed: number };

/**
 * Brings a trainee's copy up to the trainer's latest version.
 * - A changed action on a step you've practised becomes a pending update (a Change Drill: old vs new,
 *   and the old answer becomes a trap choice).
 * - A changed step you haven't practised yet just changes: there's no old habit to unlearn.
 * - New steps are added for learning; steps the trainer removed go away.
 */
export function applyTeamUpdate(pack: Pack, progress: AppState["progress"], remote: RemoteTeam, now: number): TeamUpdateResult {
  const remoteIds = new Set(remote.rules.map((r) => r.id));
  const byId = new Map(pack.rules.map((r) => [r.id, r]));
  let drills = 0;
  let quiet = 0;
  let added = 0;
  const pending: RuleUpdate[] = pack.pendingUpdates.filter((u) => remoteIds.has(u.ruleId));
  const rules: Rule[] = [];
  for (const w of remote.rules) {
    const mine = byId.get(w.id);
    if (!mine) {
      rules.push(ruleFromWire(w));
      added++;
      continue;
    }
    // What the trainee is practising now: the pending new action if one is waiting, else the rule's action.
    let waiting = pending.find((u) => u.ruleId === w.id);
    if (waiting && norm(w.action) === norm(mine.action)) {
      if (!waiting.fromTeam) {
        // The team didn't change this step; the change waiting here is one you confirmed yourself. Keep it.
        rules.push({ ...mine, situation: w.situation || mine.situation });
        continue;
      }
      // The trainer changed it back before you drilled it: nothing to unlearn.
      pending.splice(pending.indexOf(waiting), 1);
      waiting = undefined;
    }
    const current = waiting?.newAction ?? mine.action;
    const sameAction = norm(current) === norm(w.action);
    const base: Rule = { ...mine, situation: w.situation || mine.situation, ...(w.customerLine ? { customerLine: w.customerLine } : {}) };
    if (sameAction) {
      rules.push(waiting ? base : { ...base, quote: w.quote || mine.quote });
      continue;
    }
    if (progress[w.id]?.seen) {
      const update: RuleUpdate = { ruleId: w.id, newAction: w.action, newKeywords: w.keywords?.length ? w.keywords : keywordsFor(w.action), quote: w.quote, fromTeam: true };
      const at = pending.findIndex((u) => u.ruleId === w.id);
      if (at >= 0) pending.splice(at, 1, update);
      else pending.push(update);
      rules.push(base);
      drills++;
    } else {
      const { changedFrom: _c, ...rest } = base;
      rules.push({ ...rest, action: w.action, quote: w.quote, keywords: w.keywords?.length ? w.keywords : keywordsFor(w.action), ...(w.distractors?.length ? { distractors: w.distractors } : {}) });
      const at = pending.findIndex((u) => u.ruleId === w.id);
      if (at >= 0) pending.splice(at, 1);
      quiet++;
    }
  }
  // Steps the trainer removed go away; steps you added to this training yourself stay.
  const fromTeam = new Set(pack.team?.ruleIds ?? pack.rules.map((r) => r.id));
  const removed = pack.rules.filter((r) => fromTeam.has(r.id) && !remoteIds.has(r.id)).length;
  const ownSteps = pack.rules.filter((r) => !fromTeam.has(r.id) && !remoteIds.has(r.id));
  const keptIds = new Set([...remoteIds, ...ownSteps.map((r) => r.id)]);
  return {
    pack: {
      ...pack,
      title: remote.title || pack.title,
      trainer: remote.trainer || pack.trainer,
      place: remote.place ?? pack.place,
      questions: remote.questions,
      rules: [...rules, ...ownSteps],
      pendingUpdates: [...pending, ...pack.pendingUpdates.filter((u) => !remoteIds.has(u.ruleId) && keptIds.has(u.ruleId))],
      team: { ...(pack.team ?? { code: remote.code, role: "trainee" }), version: remote.version, syncedAt: now, stopped: false, ruleIds: [...remoteIds] },
    },
    drills,
    quiet,
    added,
    removed,
  };
}

/**
 * The trainer's side: a change confirmed into a shared training applies straight away (the trainer
 * doesn't need to drill their own rule) and marks the training as having something to send.
 */
export function applyDirect(pack: Pack, updates: RuleUpdate[], added: Rule[]): Pack {
  const rules = pack.rules.map((r) => {
    const u = updates.find((x) => x.ruleId === r.id);
    if (!u) return r;
    const { distractors: _d, ...rest } = r;
    return { ...rest, changedFrom: r.action, action: u.newAction, keywords: u.newKeywords.length ? u.newKeywords : keywordsFor(u.newAction), quote: u.quote };
  });
  return {
    ...pack,
    rules: [...rules, ...added],
    pendingUpdates: pack.pendingUpdates.filter((u) => !updates.some((x) => x.ruleId === u.ruleId)),
    ...(pack.team ? { team: { ...pack.team, dirty: pack.team.dirty || updates.length > 0 || added.length > 0 } } : {}),
  };
}

/** Plain words for a trainee's notification. */
export function updateMessage(trainer: string, title: string, r: Pick<TeamUpdateResult, "drills" | "quiet" | "added" | "removed">): string | null {
  const parts = [
    r.drills ? `changed ${r.drills} step${r.drills > 1 ? "s" : ""} you've practised` : "",
    r.quiet ? `updated ${r.quiet} step${r.quiet > 1 ? "s" : ""}` : "",
    r.added ? `added ${r.added} new step${r.added > 1 ? "s" : ""}` : "",
    r.removed ? `removed ${r.removed} step${r.removed > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return `${trainer} ${parts.join(", ")} in ${title}.`;
}

/** Validates the coach service's reply for one team; anything malformed is dropped, never trusted. */
export function cleanRemote(raw: unknown): RemoteTeam | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const code = s(r.code, 6).toUpperCase();
  const version = Number(r.version);
  if (!validCode(code) || !Number.isFinite(version) || version < 1 || !Array.isArray(r.rules)) return null;
  const rules = (r.rules as unknown[])
    .slice(0, 100)
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x): WireRule => ({
      id: s(x.id, 80),
      situation: s(x.situation, 300),
      action: s(x.action, 400),
      quote: s(x.quote, 600),
      ...(Array.isArray(x.keywords) ? { keywords: (x.keywords as unknown[]).map((k) => s(k, 40)).filter(Boolean).slice(0, 8) } : {}),
      ...(s(x.customerLine, 300) ? { customerLine: s(x.customerLine, 300) } : {}),
      ...(Array.isArray(x.distractors) ? { distractors: (x.distractors as unknown[]).map((d) => s(d, 300)).filter(Boolean).slice(0, 4) } : {}),
    }))
    .filter((x) => x.id && x.situation && x.action);
  return {
    code,
    version,
    title: s(r.title, 120) || "Team training",
    trainer: s(r.trainer, 80) || "Your trainer",
    place: s(r.place, 120),
    rules,
    questions: Array.isArray(r.questions) ? (r.questions as unknown[]).map((q) => s(q, 300)).filter(Boolean).slice(0, 20) : [],
    ...(Number.isFinite(Number(r.members)) ? { members: Number(r.members) } : {}),
  };
}
