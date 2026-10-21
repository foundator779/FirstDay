// Practice reminders: a FirstDay notification on this phone before your next shift ("Practise Juniper Café before
// your shift: 3 steps"), cleared once you've practised those steps. (Reminders an older version wrote into Bee as a
// to-do are still checked off there.)
import type { AppState, Pack, PracticeReminder } from "./types";

const steps = (n: number) => `${n} step${n === 1 ? "" : "s"}`;

/** What the Bee to-do says. Short, because it shows on a watch. */
export function reminderText(pack: Pick<Pack, "title" | "trainer">, kind: PracticeReminder["kind"], count: number): string {
  const title = pack.title.length > 40 ? `${pack.title.slice(0, 39)}…` : pack.title;
  if (kind === "change") {
    const who = pack.trainer && pack.trainer !== "Your trainer" ? pack.trainer : "Your trainer";
    return `${who} changed ${steps(count)} in ${title}: do the Change Drill in FirstDay Go`;
  }
  return `Practise ${title} before your shift: ${steps(count)} in FirstDay Go`;
}

/** Done once every step it named has been practised since it was set, and no change is still waiting. */
export function reminderDone(pack: Pack, progress: AppState["progress"], r: PracticeReminder): boolean {
  if (r.kind === "change" && pack.pendingUpdates.some((u) => r.ruleIds.includes(u.ruleId))) return false;
  const live = r.ruleIds.filter((id) => pack.rules.some((x) => x.id === id));
  return live.length > 0 && live.every((id) => (progress[id]?.last ?? 0) >= r.createdAt);
}

/** Quick times to pick from: before a shift later today, tonight, or tomorrow morning. */
export function reminderTimes(now: number): { label: string; at: number }[] {
  const d = new Date(now);
  const at = (dayOffset: number, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, 0, 0, 0).getTime();
  const out: { label: string; at: number }[] = [{ label: "In 1 hour", at: now + 3600_000 }];
  if (d.getHours() < 18) out.push({ label: "Tonight, 7 PM", at: at(0, 19) });
  out.push({ label: "Tomorrow, 7 AM", at: at(1, 7) }, { label: "Tomorrow, 9 AM", at: at(1, 9) });
  return out;
}
