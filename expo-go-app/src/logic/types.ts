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
  /** Came from the trainer's team update (not from your own capture). */
  fromTeam?: boolean;
};

/**
 * A training shared through FirstDay's coach service: the trainer (or job coach) shares it with a
 * join code, and every rule they change later reaches each trainee as a Change Drill.
 */
export type TeamLink = {
  code: string;
  role: "trainer" | "trainee";
  /** The service's version this copy matches. */
  version: number;
  syncedAt: number;
  /** Trainer: changed here since the last send to the team. */
  dirty?: boolean;
  /** Trainer: how many people are in. */
  members?: number;
  /** Trainer: how many people are waiting to be let in. */
  requests?: number;
  /** Trainer: "Let anyone with the code in" is on. */
  open?: boolean;
  /** Trainee: the trainer stopped sharing (or removed you). This copy stays. */
  stopped?: boolean;
  /** Trainee: the trainer removed you from the team. */
  removed?: boolean;
  /** Trainee: the steps that came from the team, so steps you added yourself survive an update. */
  ruleIds?: string[];
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
  /** Set when this training is shared with a team (as trainer) or came from one (as trainee). */
  team?: TeamLink;
  /** A practice reminder waiting in Bee (or on this phone). See logic/wrist.ts. */
  reminder?: PracticeReminder;
};

/** A practice reminder: a notification on this phone (`via: "bee"` only for ones an older version put in Bee). */
export type PracticeReminder = {
  kind: "practise" | "change";
  via: "bee" | "phone";
  /** The Bee to-do id, or the phone notification id. */
  id: string;
  at: number;
  createdAt: number;
  /** The steps to practise before it counts as done. */
  ruleIds: string[];
};

/** A training you asked to join: the trainer hasn't let you in yet, or said no. */
export type TeamRequest = {
  code: string;
  title: string;
  trainer: string;
  askedAt: number;
  status: "pending" | "declined";
};

/** Something vague a trainer said ("maybe allow another day"): asked about, never practised as a rule. */
export type TrainerQuestion = {
  id: string;
  text: string;
  /** The vague line, word for word. */
  quote?: string;
  /** The conversation it came from. */
  fromId?: string;
  /** The training it belongs to, when known. */
  packId?: string;
  createdAt: number;
  /** When you said you asked it. */
  askedAt?: number;
};

/** "Use my trainings in other apps": the coach MCP server and the voice screen. */
export type CoachLink = {
  on: boolean;
  /** Last time the confirmed rules were sent to the coach service. */
  pushedAt: number;
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
  /** Use the FirstDay AWS endpoint (Amazon Bedrock) for smarter reading when signed in. */
  cloudAi: boolean;
  /** Send accepted to-dos and memory fixes back to Bee through the brain. */
  syncToBee: boolean;
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
  /** phone = on-device rules, brain = Bedrock via the computer helper, cloud = Bedrock via the AWS endpoint. */
  analyzedBy: "phone" | "brain" | "cloud";
  beeId?: string;
  /** A replay of a real Bee recording saved in the app (see logic/replays.ts), not a live Bee read. */
  replayId?: string;
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
  /** Linked Bee to-do (two-way: completing here completes it in Bee). */
  beeTodoId?: string;
  /** Bee's own to-do suggestion; accepting or skipping here does the same in Bee. */
  beeSuggestionId?: string;
  /** Came from Bee (not written here first). */
  fromBee?: boolean;
  /** When this item was linked to Bee; a sync that started earlier can't unlink or delete it. */
  linkedAt?: number;
  /** Bee's completed flag as last seen, so only a change in Bee ticks it here. */
  beeDone?: boolean;
  /** The due time is Bee's own alarm, so FirstDay doesn't nudge as well. */
  beeAlarm?: boolean;
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
  /** Linked Bee fact (two-way: confirm, edit and delete reach Bee). */
  beeFactId?: string;
  fromBee?: boolean;
  linkedAt?: number;
};

/** Your own 1–5 answer to "How did today feel?" (evening review or Patterns). */
export type MoodEntry = { day: string; score: 1 | 2 | 3 | 4 | 5; at: number };

/** The AI's written look across recent weeks, kept until you ask again. */
export type Reflection = { text: string; at: number; sources: string[]; by: "brain" | "cloud" };

export type ChatMessage = { id: string; role: "me" | "app"; text: string; at: number; sources?: string[] };

/** A rule candidate waiting to be sorted into a training pack. */
export type SuggestedRule = {
  id: string;
  fromId: string;
  situation: string;
  action: string;
  quote: string;
};

export type Brain = {
  url: string;
  code: string;
  ai: boolean;
  bee: boolean;
  live?: boolean;
  /** The brain was started with FIRSTDAY_GO_REQUIRE_ACCOUNT=1, so requests carry the Cognito token. */
  withToken?: boolean;
  /** Bee through the FirstDay Bee service in AWS (Connect Bee), not a computer on your Wi-Fi. */
  cloudBee?: boolean;
};

/** What the brain read from Bee (the Bee CLI's facts, to-dos, suggestions, daily summary, insights). */
export type BeeSnapshot = {
  facts: { id: string; text: string; confirmed: boolean }[] | null;
  todos: { id: string; text: string; completed: boolean; alarmAt?: number }[] | null;
  suggestions: { id: string; text: string }[] | null;
  daily: { date: string; lines: string[] } | null;
  insights: { id: string; text: string }[] | null;
  /** True only when the brain saw Bee's whole list, so deletions there can be mirrored here. */
  complete: { facts: boolean; todos: boolean; suggestions: boolean };
  failed: string[];
};

export type BeeInboxItem = { id: string; title: string; at: number };

/** Bee data shown on Today, plus sync status. */
export type BeeState = {
  daily: { date: string; lines: string[] } | null;
  insights: string[];
  syncedAt: number;
  /** New Bee conversations the brain saw since you last looked. */
  inbox: BeeInboxItem[];
  /** Inbox ids already announced with a notification. */
  notified: string[];
  todosChangedAt: number;
  /** Bee items removed here only ("fact:<id>", "todo:<id>", "sugg:<id>"), so a sync doesn't bring them back. */
  hidden: string[];
  lastError?: string;
};

/** A win on your record (logic/wins.ts): praise heard in a conversation, or something you learned here. */
export type Win = {
  id: string;
  kind: "praise" | "practice";
  /** One line: the exact quote for praise, what you did for practice. */
  text: string;
  /** Exact words from the conversation (praise). */
  quote?: string;
  /** Who said it: you confirm it (Bee labels every speaker "Unknown"). */
  who?: string;
  at: number;
  /** The conversation it came from (praise) or the training (practice). */
  fromId?: string;
  packId?: string;
  /** Where a praise line came from: a Bee conversation, or something pasted or typed. */
  source?: "bee" | "pasted" | "note" | "sample";
  /** From a replayed real Bee recording. */
  replay?: boolean;
  /** Found in a conversation and not kept yet: it isn't on your record until you keep it. */
  suggested: boolean;
  /** For practice milestones, so each one is recorded once. */
  key?: string;
};

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
  bee: BeeState;
  /** Your mood check-ins, oldest first. */
  moods: MoodEntry[];
  /** The latest AI look across recent weeks. */
  reflection: Reflection | null;
  /** Questions for your trainer, from vague lines in trainings. */
  questions: TrainerQuestion[];
  /** Sharing your confirmed rules with other apps (MCP) and the voice screen. Null until turned on. */
  coach: CoachLink | null;
  /** Trainings you asked to join that the trainer hasn't let you into. */
  teamRequests: TeamRequest[];
  /** My record: wins for your reviews and promotions. */
  wins: Win[];
};
