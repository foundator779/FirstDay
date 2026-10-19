// In-memory stand-in for store.mjs (same behaviour), used by the tests.
export function memoryStore() {
  const m = new Map();
  return {
    async get(user) {
      const r = m.get(user);
      if (r && r.expiresAt && r.expiresAt * 1000 < Date.now()) return { ...structuredClone(r), status: "none", sealed: "", expired: true };
      return r ? structuredClone(r) : null;
    },
    async put(user, rec, expectedVersion) {
      const cur = m.get(user);
      if ((cur?.version ?? 0) !== expectedVersion) return false;
      m.set(user, structuredClone({ ...rec, version: expectedVersion + 1, updatedAt: Date.now() }));
      return true;
    },
    async remove(user) {
      m.delete(user);
    },
    _raw: m,
  };
}
