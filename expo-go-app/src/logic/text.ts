const STOP = new Set(
  ("a an the and or but if then than so to of in on at by for from with into onto it its it's this that these those " +
    "is are was were be been being do does did doing you your yours we our us they them their he she his her i me my " +
    "as up out over under before after when whenever while once also just only both each any all some no not " +
    "can could will would should must may might shall have has had get got make sure please let lets let's " +
    "there here what which who whom how about give gets").split(/\s+/),
);

/** Very small stemmer: enough to match "records" with "record", "handing" with "hand". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Up to `max` distinct content words, in order of appearance. */
export function keywordsFor(text: string, max = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of contentWords(text)) {
    const s = stem(w);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

export function overlap(a: string, b: string): number {
  const A = new Set(contentWords(a).map(stem));
  const B = new Set(contentWords(b).map(stem));
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  A.forEach((w) => {
    if (B.has(w)) hit++;
  });
  return hit / Math.min(A.size, B.size);
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}

export function capitalize(text: string): string {
  const t = text.trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

export function sentence(text: string): string {
  const t = capitalize(text.trim().replace(/\s+/g, " "));
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function dayKey(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
