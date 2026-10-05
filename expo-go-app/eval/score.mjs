// Scores extracted work rules against eval/corpus.json. Plain JS (no dependencies) so it runs in
// Node, CloudShell or CI. A predicted rule matches an expected one when at least 75% of the expected
// key words appear in its situation + action (numbers and number words are treated as equal).

const NUMBER_WORDS = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30",
};

const stem = (w) => (w.length > 4 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 3 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

export function tokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .map(stem);
}

const coverage = (keywords, text) => {
  const have = new Set(tokens(text));
  const want = keywords.flatMap((k) => tokens(k));
  return want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
};

const normalize = (t) => String(t ?? "").replace(/^\s*[A-Z][\w .'-]{0,30}:\s+/, "").replace(/\s+/g, " ").trim().toLowerCase();

/** predicted = { rules: [{ action, situation?, quote?, isUpdate? }], questions: [string] } */
export function scoreCase(c, predicted) {
  const rules = Array.isArray(predicted.rules) ? predicted.rules : [];
  const questions = Array.isArray(predicted.questions) ? predicted.questions : [];
  const used = new Set();
  let matched = 0;
  let updatesFound = 0;
  for (const e of c.rules) {
    let best = -1;
    let bestScore = 0;
    rules.forEach((p, i) => {
      if (used.has(i)) return;
      // A rule is its situation plus its action ("If the line has more than five people, page a cashier").
      const s = coverage(e.action, `${p.situation ?? ""} ${p.action}`);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= 0.75) {
      used.add(best);
      matched++;
      if (e.update && rules[best].isUpdate) updatesFound++;
    }
  }
  const transcript = String(c.transcript).toLowerCase().replace(/\s+/g, " ");
  const verbatim = rules.filter((p) => p.quote && transcript.includes(normalize(p.quote))).length;
  const leaks = c.notRules.filter((k) => rules.some((p) => tokens(`${p.situation ?? ""} ${p.action} ${p.quote ?? ""}`).includes(stem(k.toLowerCase())))).length;
  const questionsFound = c.questions.filter((k) => questions.some((q) => tokens(q).includes(stem(k.toLowerCase())))).length;
  return {
    id: c.id,
    expected: c.rules.length,
    predicted: rules.length,
    matched,
    updatesExpected: c.rules.filter((e) => e.update).length,
    updatesFound,
    questionsExpected: c.questions.length,
    questionsFound,
    leaks,
    verbatim,
  };
}

export function summarize(results) {
  const sum = (k) => results.reduce((n, r) => n + r[k], 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 100);
  const precision = pct(sum("matched"), sum("predicted"));
  const recall = pct(sum("matched"), sum("expected"));
  return {
    cases: results.length,
    rulesExpected: sum("expected"),
    rulesPredicted: sum("predicted"),
    rulesMatched: sum("matched"),
    precision,
    recall,
    f1: precision + recall ? Math.round(((2 * precision * recall) / (precision + recall)) * 10) / 10 : 0,
    vagueLinesTurnedIntoRules: sum("leaks"),
    questionsFound: `${sum("questionsFound")}/${sum("questionsExpected")}`,
    updatesFlagged: `${sum("updatesFound")}/${sum("updatesExpected")}`,
    quotesVerbatim: pct(sum("verbatim"), sum("predicted")),
  };
}

export function report(name, results) {
  const s = summarize(results);
  const lines = [
    `${name}: ${s.cases} transcripts, ${s.rulesExpected} expected rules`,
    `  precision ${s.precision}%  recall ${s.recall}%  F1 ${s.f1}`,
    `  vague or chatty lines turned into rules: ${s.vagueLinesTurnedIntoRules}`,
    `  vague lines turned into trainer questions: ${s.questionsFound}`,
    `  rule updates flagged as updates: ${s.updatesFlagged}`,
    `  quotes copied verbatim from the transcript: ${s.quotesVerbatim}%`,
    "",
    ...results.map((r) => `  ${r.id.padEnd(18)} matched ${r.matched}/${r.expected}, predicted ${r.predicted}${r.leaks ? `, LEAKED ${r.leaks}` : ""}`),
  ];
  return { summary: s, text: lines.join("\n") };
}
