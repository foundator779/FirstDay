import { File, Paths } from "expo-file-system";

/**
 * Each signed-in account gets its own file on this phone, so a new account starts empty and two
 * people sharing a phone never see each other's notes. Signed out (no user) nothing is saved.
 */
const fileName = (user: string) => `firstday-go-state-v2-${user.replace(/[^A-Za-z0-9-]/g, "")}.json`;

function file(user: string) {
  return new File(Paths.document, fileName(user));
}

export async function loadRaw(user: string | null): Promise<unknown | null> {
  if (!user) return null;
  try {
    const f = file(user);
    if (!f.exists) return null;
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { user: string; json: string } | undefined;

function flush() {
  if (pending === undefined) return;
  const { user, json } = pending;
  pending = undefined;
  try {
    const f = file(user);
    if (!f.exists) f.create();
    f.write(json);
  } catch {
    // Saving is best effort; the app keeps working in memory.
  }
}

export function saveSoon(user: string | null, value: unknown) {
  if (!user) return;
  // A save still waiting for a different account is written first, to that account's file.
  if (pending && pending.user !== user) flush();
  pending = { user, json: JSON.stringify(value) };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

export function saveNow() {
  if (timer) clearTimeout(timer);
  flush();
}

export function wipe(user: string | null) {
  if (!user) return;
  if (pending?.user === user) pending = undefined;
  try {
    const f = file(user);
    if (f.exists) f.delete();
  } catch {}
}
