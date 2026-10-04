import { capitalize, keywordsFor, overlap, sentence } from "./text";
import type { Pack, Rule, RuleUpdate } from "./types";

export type Candidate = {
  situation: string;
  action: string;
  quote: string;
  isUpdate: boolean;
};

export type Extraction = {
  candidates: Candidate[];
  /** Tentative lines ("maybe…", "usually…") that should be asked about, not practised. */
  questions: string[];
};

const TENTATIVE = /\b(maybe|might|usually|sometimes|probably|not sure|i think|kind of|sort of|depends|i guess)\b/i;
const UPDATE = /^(update|updated|change|new rule|starting today|starting now|from now on|from today|going forward)\s*[:,-]?\s*/i;
const SPEAKER = /^(?:\[[^\]]*\]\s*)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?([A-Z][\w .'-]{0,30}|Speaker \d+)\s*:\s+/;
const CONDITION = /^(when|whenever|if|once|after|before|every time)\s+(.+?),\s*(?:then\s+)?(.+)$/i;
const DIRECTIVE = /^(always|never|make sure|remember to|don't|do not|you need to|you have to|you must|you should|please)\b/i;
const POLICY = /\b(we|you|staff|everyone)\s+(always|never|must|should|need to|have to|hold|keep|check|ask)\b/i;
const META = /\b(fictional|for the firstday demo|private practice|used for my|onboarding conversation to be|take a break|let's|we'll cover|got it|exactly|great\.?$)\b/i;

/** Split a pasted transcript into trimmed lines/sentences without speaker labels. */
export function splitLines(text: string): string[] {
  return text
    .replace(/([.!?])\s+(?=(?:Update|When|Whenever|If|Before|After|Once|Always|Never|Make sure|Don't|Remember|Starting|From now)\b)/g, "$1\n")
    .split(/\r?\n+/)
    .map((line) => line.replace(SPEAKER, "").trim())
    .filter(Boolean);
}

/** "When a visitor borrows a kit" -> "A visitor borrows a kit." */
export function sceneFrom(conditionWord: string, rest: string): string {
  const word = conditionWord.toLowerCase();
  if (word === "before") {
    const you = /^you\s+(.+)$/i.exec(rest);
    return you ? sentence(`You're about to ${you[1]}`) : sentence(`Right before ${rest}`);
  }
  if (word === "after") {
    const you = /^you\s+(.+)$/i.exec(rest);
    return you ? sentence(`You just ${you[1]}`) : sentence(`Right after ${rest}`);
  }
  return sentence(rest);
}

export function extract(text: string): Extraction {
  const candidates: Candidate[] = [];
  const questions: string[] = [];
  for (const raw of splitLines(text)) {
    if (raw.endsWith("?")) continue;
    if (raw.split(/\s+/).length < 5) continue;
    let line = raw;
    let isUpdate = false;
    const upd = UPDATE.exec(line);
    if (upd) {
      isUpdate = true;
      line = capitalize(line.slice(upd[0].length));
    }
    if (META.test(line) && !CONDITION.test(line)) continue;
    if (TENTATIVE.test(line)) {
      questions.push(`“${raw}” — what is the exact rule here?`);
      continue;
    }
    const cond = CONDITION.exec(line);
    if (cond) {
      candidates.push({
        situation: sceneFrom(cond[1]!, cond[2]!),
        action: sentence(cond[3]!),
        quote: raw,
        isUpdate,
      });
      continue;
    }
    if (DIRECTIVE.test(line) || POLICY.test(line)) {
      candidates.push({ situation: "During your shift.", action: sentence(line), quote: raw, isUpdate });
    }
  }
  return { candidates, questions };
}

export function ruleFromCandidate(c: Candidate, id: string): Rule {
  return { id, situation: c.situation, action: c.action, quote: c.quote, keywords: keywordsFor(c.action) };
}

/**
 * Sort candidates into brand-new rules and updates to existing rules of `pack`.
 * A candidate counts as an update when its situation matches an existing rule.
 */
export function matchUpdates(
  pack: Pack,
  candidates: Candidate[],
  newId: () => string,
): { updates: RuleUpdate[]; added: Rule[] } {
  const updates: RuleUpdate[] = [];
  const added: Rule[] = [];
  for (const c of candidates) {
    let best: Rule | undefined;
    let bestScore = 0;
    for (const r of pack.rules) {
      const score = overlap(c.situation, r.situation);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    const generic = c.situation === "During your shift." || best?.situation === "During your shift.";
    if (best && bestScore >= 0.5 && (!generic || overlap(best.action, c.action) >= 0.5)) {
      if (overlap(best.action, c.action) >= 0.999 && best.action.length === c.action.length) continue;
      const dup = updates.findIndex((u) => u.ruleId === best!.id);
      if (dup >= 0) updates.splice(dup, 1);
      updates.push({ ruleId: best.id, newAction: c.action, newKeywords: keywordsFor(c.action), quote: c.quote });
    } else {
      added.push(ruleFromCandidate(c, newId()));
    }
  }
  return { updates, added };
}
