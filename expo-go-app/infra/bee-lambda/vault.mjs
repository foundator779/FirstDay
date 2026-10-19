// Encryption for the Bee sign-in that the FirstDay Bee service keeps for you.
//
// Your Bee sign-in is the small folder `bee login` writes (~/.bee). Between requests it is stored in
// DynamoDB only as AES-256-GCM ciphertext. The key is derived from a random 32-byte secret that is
// created on your phone, kept in the phone's secure storage and sent with each request: the service
// never stores it. So the stored sign-in is useless on its own; it can only be opened while your
// FirstDay app is asking. (DynamoDB also encrypts everything at rest on its side.)
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const KEY_HEADER = "x-firstday-bee-key";
const INFO = Buffer.from("firstday-bee-signin-v1");
const MAX_FOLDER_BYTES = 1_000_000;

/** The phone's secret: exactly 32 bytes, base64url. Returns a Buffer or null. */
export function parsePhoneKey(value) {
  const s = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  const b = Buffer.from(s, "base64url");
  return b.length === 32 ? b : null;
}

/** Per-user AES key: HKDF-SHA256(phone secret, salt = Cognito user id). */
export function deriveKey(phoneKey, userId) {
  return Buffer.from(hkdfSync("sha256", phoneKey, Buffer.from(String(userId)), INFO, 32));
}

/** Encrypts a JSON-able value. The user id is bound as additional data, so a blob can't be moved to another user. */
export function seal(value, key, userId) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`user:${userId}`));
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

/** Decrypts what `seal` produced. Throws if the key is wrong or the blob was changed. */
export function open(sealed, key, userId) {
  const [v, iv, tag, body] = String(sealed).split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("bad-blob");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(`user:${userId}`));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8"));
}

/** Reads a folder into { "relative/path": base64 }, skipping `skip` top-level names. Refuses over 1 MB (a sign-in is a few KB). */
export function readFolder(dir, skip = []) {
  const files = {};
  let total = 0;
  const walk = (d) => {
    let names = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      if (d === dir && skip.includes(name)) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) {
        total += st.size;
        if (total > MAX_FOLDER_BYTES) throw new Error("folder-too-big");
        files[relative(dir, p).split(sep).join("/")] = readFileSync(p).toString("base64");
      }
    }
  };
  walk(dir);
  return files;
}

/** Writes { "relative/path": base64 } back under `dir`, never outside it. */
export function writeFolder(dir, files) {
  const root = resolve(dir);
  for (const [rel, b64] of Object.entries(files ?? {})) {
    const p = resolve(root, rel);
    if (p !== root && !p.startsWith(root + sep)) throw new Error("bad-path");
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    writeFileSync(p, Buffer.from(String(b64), "base64"), { mode: 0o600 });
  }
}

/** Stable fingerprint of a folder snapshot, to skip saving when nothing changed. */
export function sameFolder(a, b) {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
