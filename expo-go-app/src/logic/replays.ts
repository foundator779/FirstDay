// Real Bee recordings, saved so anyone can replay them without a Bee.
// Both were recorded by Bee on an Apple Watch on October 18, 2026 (the café training in the demo video). The text is
// Bee's own transcript, copied word for word from the app's "Word for word · from Bee" view; Bee labelled every
// speaker "Unknown". Replaying one runs the same live path as a new Bee conversation: your OK, then Amazon Bedrock
// (through your FirstDay account) finds the work steps, questions and to-dos. Nothing is pre-extracted.

export type RealRecording = {
  /** Stable id, so a replay you already did just opens. */
  id: string;
  /** Bee's title for it (the update was still "Processing…" in Bee, so it has ours). */
  title: string;
  /** When Bee recorded it (Phoenix time, UTC−7). */
  recordedAt: number;
  /** What it is, in one line, shown before you replay it. */
  about: string;
  text: string;
};

export const REAL_RECORDINGS: RealRecording[] = [
  {
    id: "real-bee-2026-10-18-cafe",
    title: "Cafe Shift Procedures and Updates",
    recordedAt: Date.parse("2026-10-18T07:27:00-07:00"),
    about: "Rosa's first-day training at Juniper Café, about a minute. Bee recorded it on an Apple Watch.",
    text: [
      "Unknown: A few",
      "Unknown: Welcome.",
      "Unknown: A few things for today.",
      "Unknown: When a customer brings back a cracked mug, check the receipt first, then put the mug in the gray bin.",
      "Unknown: If someone orders oat milk, write OAT on the lid in capitals.",
      "Unknown: Before closing, wipe the steam wand and run it for three seconds.",
      "Unknown: Maybe we'll start giving refunds on Sundays too.",
      "Unknown: I'm not sure yet.",
      "Unknown: Oh, and can you restock the paper cups by noon tomorrow?",
      "Unknown: Got it.",
      "Unknown: My shift ends at four on Fridays.",
      "Unknown: That's right.",
    ].join("\n"),
  },
  {
    id: "real-bee-2026-10-18-update",
    title: "Rosa's quick update",
    recordedAt: Date.parse("2026-10-18T07:45:00-07:00"),
    about: "Eighteen minutes later, Rosa changes the cracked-mug rule. Replay it after the café training to get a Change Drill.",
    text: [
      "Unknown: Quick update.",
      "Unknown: From now on, when a customer brings back a cracked mug, check the receipt, then put it in the blue crate by the sink, not the gray bin.",
    ].join("\n"),
  },
];

export const realRecording = (id: string) => REAL_RECORDINGS.find((r) => r.id === id);
