// FirstDay coach as a remote MCP server: Model Context Protocol, spec version 2025-11-25, Streamable HTTP
// transport (single JSON responses, no SSE stream). Any MCP client (an AI assistant, an Alexa-style voice
// screen, MCP Inspector) can quiz the user on the work steps they confirmed against the trainer's words.
// Tools are read-only. This file is the protocol and the tools; app.mjs does HTTP, auth and storage.
import { changedRules, choosePacks, feedback, findRules, findStep, flatten, grade, pickQuiz } from "./coach.mjs";

export const LATEST = "2025-11-25";
export const SUPPORTED_VERSIONS = [LATEST, "2025-06-18", "2025-03-26"];

export const SERVER_INFO = {
  name: "firstday-coach",
  title: "FirstDay coach",
  version: "1.0.0",
  description: "Quizzes you on the work steps you confirmed in FirstDay Go, using only your trainer's exact words.",
  websiteUrl: "https://github.com/foundator779/FirstDay",
};

const INSTRUCTIONS =
  "FirstDay coach helps someone (often with ADHD) rehearse their new job. Every step was confirmed by the user against the trainer's exact words. " +
  "Ask one situation at a time and wait for the answer. Check it with check_answer and always read back the trainer's quote. " +
  "Never invent a procedure: if find_step returns nothing, say you don't know and suggest asking the trainer (trainer_questions lists what's still unclear). " +
  "Keep it short and kind; offer to stop after three.";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const str = (description) => ({ type: "string", description });
const stepShape = {
  type: "object",
  properties: { training: { type: "string" }, situation: { type: "string" }, action: { type: "string" }, trainerSaid: { type: "string" }, trainer: { type: "string" } },
  required: ["training", "situation", "action", "trainerSaid", "trainer"],
};

export const TOOLS = [
  {
    name: "list_trainings",
    title: "List my trainings",
    description: "The user's trainings: how many steps each has, how many are solid, and how many the trainer changed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        trainings: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" }, trainer: { type: "string" }, steps: { type: "integer" }, solid: { type: "integer" }, changed: { type: "integer" }, sample: { type: "boolean", description: "A fictional sample training" } }, required: ["title", "trainer", "steps", "solid", "changed", "sample"] },
        },
      },
      required: ["trainings"],
    },
    annotations: { title: "List my trainings", ...readOnly },
  },
  {
    name: "quiz_me",
    title: "Quiz me",
    description:
      "Picks situations to rehearse, shakiest steps first. Read the situation (or customerLine) aloud and ask 'What do you do?'. Don't reveal `answer` or `trainerSaid` until the user has tried; then call check_answer.",
    inputSchema: {
      type: "object",
      properties: { training: str("Optional: words from a training's title, e.g. 'café'."), count: { type: "integer", minimum: 1, maximum: 10, description: "How many situations (default 3)." } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, training: { type: "string" }, situation: { type: "string" }, customerLine: { type: "string" },
              answer: { type: "string" }, trainerSaid: { type: "string" }, trainer: { type: "string" }, oldAnswerNowWrong: { type: "string" },
              sample: { type: "boolean", description: "From a fictional sample training: say so." },
            },
            required: ["id", "training", "situation", "answer", "trainerSaid", "trainer"],
          },
        },
      },
      required: ["questions"],
    },
    annotations: { title: "Quiz me", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "check_answer",
    title: "Check my answer",
    description:
      "Checks what the user said they would do against the trainer's key words (any order, paraphrase is fine). After a rule changed, the old way never passes. Returns feedback that quotes the trainer.",
    inputSchema: {
      type: "object",
      properties: { id: str("The step id from quiz_me (preferred)."), situation: str("Or the situation text, if you don't have an id."), answer: str("What the user said they would do.") },
      required: ["answer"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        pass: { type: "boolean" }, oldWay: { type: "boolean" }, missing: { type: "array", items: { type: "string" } },
        answer: { type: "string" }, trainerSaid: { type: "string" }, trainer: { type: "string" }, feedback: { type: "string" },
      },
      required: ["pass", "oldWay", "missing", "answer", "trainerSaid", "trainer", "feedback"],
    },
    annotations: { title: "Check my answer", ...readOnly },
  },
  {
    name: "what_changed",
    title: "What changed",
    description: "Steps the trainer changed: before, now, and the trainer's new words.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        changed: {
          type: "array",
          items: { type: "object", properties: { training: { type: "string" }, situation: { type: "string" }, before: { type: "string" }, now: { type: "string" }, trainerSaid: { type: "string" } }, required: ["training", "situation", "before", "now", "trainerSaid"] },
        },
      },
      required: ["changed"],
    },
    annotations: { title: "What changed", ...readOnly },
  },
  {
    name: "find_step",
    title: "Find a step",
    description: "Answers 'what do I do when…' with the user's confirmed steps only. Empty means: don't guess, ask the trainer.",
    inputSchema: { type: "object", properties: { query: str("The situation in plain words, e.g. 'a customer returns a cracked mug'.") }, required: ["query"], additionalProperties: false },
    outputSchema: { type: "object", properties: { matches: { type: "array", items: stepShape } }, required: ["matches"] },
    annotations: { title: "Find a step", ...readOnly },
  },
  {
    name: "trainer_questions",
    title: "Questions for my trainer",
    description: "Things the trainer said vaguely that the user still has to ask about. Never treat these as rules.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: { questions: { type: "array", items: { type: "string" } } }, required: ["questions"] },
    annotations: { title: "Questions for my trainer", ...readOnly },
  },
];

export const PROMPTS = [
  {
    name: "shift_warmup",
    title: "Warm up before my shift",
    description: "A three-question rehearsal of your trainings, one situation at a time.",
    arguments: [{ name: "training", description: "Optional: words from a training's title", required: false }],
  },
];

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const text = (t) => [{ type: "text", text: t }];
const ok = (structured, t) => ({ content: text(t), structuredContent: structured });
const toolError = (message) => ({ content: text(message), isError: true });

/** Runs one tool for the user's coach data ({ packs, questions }). Bad arguments are tool errors the model can fix. */
export function callTool(name, args, data) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const packs = Array.isArray(data?.packs) ? data.packs : [];
  if (!packs.length && name !== "trainer_questions") {
    return toolError("No confirmed steps yet. In FirstDay Go, confirm some work steps, then More → Quiz me from other apps.");
  }
  switch (name) {
    case "list_trainings": {
      const trainings = packs.map((p) => ({ title: p.title, trainer: p.trainer, steps: p.rules.length, solid: p.rules.filter((r) => r.level >= 3).length, changed: p.rules.filter((r) => r.changedFrom).length, sample: p.sample === true }));
      return ok({ trainings }, trainings.map((t) => `${t.title}${t.sample ? " (fictional sample)" : ""} (from ${t.trainer}): ${t.steps} steps, ${t.solid} solid${t.changed ? `, ${t.changed} changed` : ""}`).join("\n"));
    }
    case "quiz_me": {
      if (a.count !== undefined && (!Number.isInteger(a.count) || a.count < 1 || a.count > 10)) return toolError("count must be a whole number from 1 to 10.");
      if (a.training !== undefined && typeof a.training !== "string") return toolError("training must be text.");
      const chosen = choosePacks(packs, a.training);
      if (!chosen.length) return toolError(`No training matches "${a.training}". Call list_trainings to see their names.`);
      const picked = pickQuiz(flatten(chosen), a.count ?? 3);
      const questions = picked.map((r) => ({
        id: r.id, training: r.pack, situation: r.situation, ...(r.customerLine ? { customerLine: r.customerLine } : {}),
        answer: r.action, trainerSaid: r.quote, trainer: r.trainer, ...(r.changedFrom ? { oldAnswerNowWrong: r.changedFrom } : {}),
        ...(r.sample ? { sample: true } : {}),
      }));
      return ok(
        { questions },
        `${questions.map((q, i) => `Q${i + 1} [${q.training}${q.sample ? ", fictional sample" : ""}] ${q.customerLine ? `"${q.customerLine}" ` : ""}${q.situation} What do you do?`).join("\n")}\n` +
          "(Answers are in the structured result. Don't reveal them until the user has tried; then call check_answer.)",
      );
    }
    case "check_answer": {
      if (typeof a.answer !== "string" || !a.answer.trim()) return toolError("answer is required: what the user said they would do.");
      if (a.id !== undefined && typeof a.id !== "string") return toolError("id must be text.");
      if (a.situation !== undefined && typeof a.situation !== "string") return toolError("situation must be text.");
      if (!a.id && !a.situation) return toolError("Give the step id from quiz_me, or the situation.");
      const step = findStep(flatten(packs), { id: a.id, situation: a.situation });
      if (!step) return toolError("I couldn't find that step. Call quiz_me again and use the id it returns.");
      const r = grade(a.answer, step);
      const fb = feedback(r, step);
      return ok({ pass: r.pass, oldWay: r.oldWay, missing: r.misses, answer: step.action, trainerSaid: step.quote, trainer: step.trainer, feedback: fb }, fb);
    }
    case "what_changed": {
      const changed = changedRules(flatten(packs)).map((r) => ({ training: r.pack, situation: r.situation, before: r.changedFrom, now: r.action, trainerSaid: r.quote }));
      return ok({ changed }, changed.length ? changed.map((c) => `[${c.training}] ${c.situation}\nBefore: ${c.before}\nNow: ${c.now}\nTrainer said: "${c.trainerSaid}"`).join("\n\n") : "Nothing has changed.");
    }
    case "find_step": {
      if (typeof a.query !== "string" || !a.query.trim()) return toolError("query is required.");
      const matches = findRules(flatten(packs), a.query).map((r) => ({ training: r.pack, situation: r.situation, action: r.action, trainerSaid: r.quote, trainer: r.trainer }));
      return ok({ matches }, matches.length ? matches.map((m) => `[${m.training}] ${m.situation}\nDo: ${m.action}\n${m.trainer} said: "${m.trainerSaid}"`).join("\n\n") : "Nothing matches. Don't guess: ask the trainer.");
    }
    case "trainer_questions": {
      const questions = Array.isArray(data?.questions) ? data.questions : [];
      return ok({ questions }, questions.length ? questions.map((q) => `- ${q}`).join("\n") : "No open questions for the trainer.");
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${String(name).slice(0, 60)}`);
  }
}

function getPrompt(name, args) {
  if (name !== "shift_warmup") throw new RpcError(-32602, `Unknown prompt: ${String(name).slice(0, 60)}`);
  const training = typeof args?.training === "string" && args.training.trim() ? ` "${args.training.trim().slice(0, 60)}"` : "";
  return {
    description: "Warm up before my shift",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Quiz me on my${training} training before my shift. Use the FirstDay coach tools: call quiz_me with count 3, ask me one situation at a time and wait for my answer, then call check_answer and read me the feedback with my trainer's exact words. Stop after three.`,
        },
      },
    ],
  };
}

/**
 * Handles one JSON-RPC request (not a notification). `loadData` fetches the user's coach data only when a
 * tool or prompt needs it. Returns the JSON-RPC result; throws RpcError for protocol errors.
 */
export async function handleRequest(msg, { loadData }) {
  const p = msg.params && typeof msg.params === "object" ? msg.params : {};
  switch (msg.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      if (typeof p.name !== "string") throw new RpcError(-32602, "params.name is required");
      if (!TOOLS.some((t) => t.name === p.name)) throw new RpcError(-32602, `Unknown tool: ${p.name.slice(0, 60)}`);
      return callTool(p.name, p.arguments, await loadData());
    }
    case "prompts/list":
      return { prompts: PROMPTS };
    case "prompts/get":
      return getPrompt(p.name, p.arguments);
    default:
      throw new RpcError(-32601, `Method not found: ${String(msg.method).slice(0, 60)}`);
  }
}
