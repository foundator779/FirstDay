import { File, Paths } from "expo-file-system";

const FILE_NAME = "firstday-go-state-v2.json";

function file() {
  return new File(Paths.document, FILE_NAME);
}

export async function loadRaw(): Promise<unknown | null> {
  try {
    const f = file();
    if (!f.exists) return null;
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: string | undefined;

function flush() {
  if (pending === undefined) return;
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(pending);
  } catch {
    // Saving is best effort; the app keeps working in memory.
  }
  pending = undefined;
}

export function saveSoon(value: unknown) {
  pending = JSON.stringify(value);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

export function saveNow() {
  if (timer) clearTimeout(timer);
  flush();
}

export function wipe() {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {}
}
