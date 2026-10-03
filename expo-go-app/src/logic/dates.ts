const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function atTime(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Finds a simple due time in everyday phrasing: "tomorrow", "tonight", "on Friday",
 * "at 3pm", "by 5:30", "next week", "in 2 hours", "in 20 minutes".
 * Returns epoch ms, or undefined when nothing time-like is said.
 */
export function parseDue(text: string, now: number): number | undefined {
  const t = text.toLowerCase();
  const base = new Date(now);
  let day: Date | undefined;
  let hour: number | undefined;
  let minute = 0;

  const inRel = /\bin (\d{1,3}|an?|one|two|three|five|ten|fifteen|twenty|thirty) (minute|min|hour|hr)s?\b/.exec(t);
  if (inRel) {
    const map: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
    const n = map[inRel[1]!] ?? Number(inRel[1]);
    const unit = inRel[2]!.startsWith("h") ? 3600_000 : 60_000;
    return now + n * unit;
  }

  if (/\btoday\b|\bthis afternoon\b|\bthis morning\b/.test(t)) day = new Date(base);
  if (/\btonight\b|\bthis evening\b/.test(t)) {
    day = new Date(base);
    hour = 19;
  }
  if (/\btomorrow\b/.test(t)) {
    day = new Date(base);
    day.setDate(day.getDate() + 1);
  }
  if (/\bnext week\b/.test(t)) {
    day = new Date(base);
    day.setDate(day.getDate() + 7);
  }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b(?:on |by |this |next )?${DAYS[i]}\\b`).test(t)) {
      day = new Date(base);
      let diff = (i - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      day.setDate(day.getDate() + diff);
    }
  }

  const clock = /\b(?:at|by|around|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(t) ?? /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (clock) {
    let h = Number(clock[1]);
    minute = clock[2] ? Number(clock[2]) : 0;
    const mer = clock[3]?.replace(/\./g, "");
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (!mer && h >= 1 && h <= 7) h += 12; // "at 3" in conversation is nearly always 3pm
    if (h <= 23 && minute <= 59) hour = h;
  }
  if (/\bnoon\b/.test(t)) hour = 12;
  if (/\b(this morning|in the morning)\b/.test(t) && hour === undefined) hour = 9;
  if (/\bthis afternoon\b/.test(t) && hour === undefined) hour = 14;

  if (!day && hour === undefined) return undefined;
  if (!day) {
    day = new Date(base);
    const candidate = atTime(day, hour!, minute);
    if (candidate.getTime() <= now) day.setDate(day.getDate() + 1);
  }
  const due = atTime(day, hour ?? 9, minute);
  return due.getTime() <= now ? now + 3600_000 : due.getTime();
}

export function friendlyDue(due: number, now: number): string {
  const d = new Date(due);
  const n = new Date(now);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(n)) / 86400_000);
  if (due < now) return "overdue";
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function friendlyDay(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(n) - startOf(d)) / 86400_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "long" })} ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function isSameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
