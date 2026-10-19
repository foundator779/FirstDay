// In-memory stand-in for store.mjs (same behaviour, including the version check), used by the tests.
export function memoryStore() {
  const m = new Map();
  const key = (pk, sk) => `${pk}\u0000${sk}`;
  return {
    async get(pk, sk) {
      const r = m.get(key(pk, sk));
      return r ? { ...structuredClone(r.data), _v: r.v } : null;
    },
    async put(pk, sk, data, expectV) {
      const cur = m.get(key(pk, sk));
      if (expectV !== undefined && (cur?.v ?? 0) !== expectV) return false;
      const { _v, sk: _s, ...clean } = data;
      m.set(key(pk, sk), { pk, sk, v: expectV === undefined ? 1 : expectV + 1, data: structuredClone(clean) });
      return true;
    },
    async del(pk, sk) {
      m.delete(key(pk, sk));
    },
    async query(pk, prefix) {
      return [...m.values()].filter((r) => r.pk === pk && r.sk.startsWith(prefix)).map((r) => ({ ...structuredClone(r.data), sk: r.sk, _v: r.v }));
    },
    _raw: m,
  };
}
