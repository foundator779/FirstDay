/** One confirmed instruction from a training conversation. */
export type Rule = {
  id: string;
  /** The work situation, phrased as a scene: "A visitor returns a torn poster." */
  situation: string;
  /** What to do, in the trainer's terms. */
  action: string;
  /** Exact line from the source conversation. Always kept so feedback can point at it. */
  quote: string;
  /** Words a typed answer must mostly contain. */
  keywords: string[];
  /** Optional line the role-play character says. */
  customerLine?: string;
  /** Plausible wrong answers for the choice mode. */
  distractors?: string[];
  /** Previous action when the trainer changed this rule. */
  changedFrom?: string;
};

/** A change the trainer announced later ("Update: ..."). */
export type RuleUpdate = {
  ruleId: string;
  newAction: string;
  newKeywords: string[];
  quote: string;
};

export type Pack = {
  id: string;
  title: string;
  place: string;
  trainer: string;
  sample: boolean;
  createdAt: number;
  /** The conversation the rules came from. */
  source: string;
  rules: Rule[];
  /** Tentative or unclear things to ask the trainer about. */
  questions: string[];
  /** Updates not yet practised. Sample packs ship one so the change drill can be tried. */
  pendingUpdates: RuleUpdate[];
};

export type RuleProgress = {
  /** 0 = new/shaky, 4 = solid. */
  level: number;
  /** Epoch ms when it should come back for review. */
  due: number;
  seen: boolean;
  tries: number;
  firstTryWins: number;
  last?: number;
};

export type AnswerStyle = "choices" | "words";

export type Settings = {
  cardsPerSession: 3 | 5 | 10;
  answerStyle: AnswerStyle;
  focusMinutes: 0 | 5 | 10 | 15;
  readAloud: boolean;
  bigText: boolean;
  haptics: boolean;
  nudges: boolean;
};

export type SessionMode = "learn" | "review" | "change";

export type Resume = { packId: string; mode: SessionMode; ruleIds: string[]; index: number };

/** Anything captured: a Bee conversation, a dictated note, a pasted transcript, a parked thought. */
export type Conversation = {
  id: string;
  title: string;
  at: number;
  source: "note" | "bee" | "pasted" | "sample";
  text: string;
  summary: string[];
  analyzedBy: "phone" | "brain";
  beeId?: string;
  packId?: string;
  reviewed?: boolean;
  previousSummary?: string[];
};

export type Step = { id: string; text: string; done: boolean };

export type Todo = {
  id: string;
  text: string;
  bucket: "now" | "later" | "done";
  /** Suggested by analysis and not yet accepted. */
  suggested: boolean;
  due?: number;
  notificationId?: string;
  steps: Step[];
  fromId?: string;
  /** Exact line it came from, shown in Evening review. */
  quote?: string;
  reviewed?: boolean;
  previousText?: string;
  createdAt: number;
  doneAt?: number;
};

export type Memory = {
  id: string;
  text: string;
  kind: "me" | "people" | "work" | "other";
  suggested: boolean;
  fromId?: string;
  quote?: string;
  reviewed?: boolean;
  previousText?: string;
  at: number;
};

export type ChatMessage = { id: string; role: "me" | "app"; text: string; at: number; sources?: string[] };

/** A rule candidate waiting to be sorted into a training pack. */
export type SuggestedRule = {
  id: string;
  fromId: string;
  situation: string;
  action: string;
  quote: string;
};

export type Brain = { url: string; code: string; ai: boolean; bee: boolean };

export type AppState = {
  version: 2;
  packs: Pack[];
  progress: Record<string, RuleProgress>;
  settings: Settings;
  resume: Resume | null;
  today: { date: string; count: number };
  conversations: Conversation[];
  todos: Todo[];
  memories: Memory[];
  chat: ChatMessage[];
  suggestedRules: SuggestedRule[];
  brain: Brain | null;
  onboarded: boolean;
};
