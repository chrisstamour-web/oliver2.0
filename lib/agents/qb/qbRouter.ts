// lib/agents/qb/qbRouter.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { decideResearchWithClaude } from "@/lib/agents/qb/researchRouter";
import { shouldRunIcpFit } from "@/lib/agents/router";
import { loadRouterAgent } from "@/lib/runners/routerAgent";

export type DecisionMode = "rules" | "judgment" | "council" | "escalation";

export type RoutingDecision = {
  agents_to_call: string[];
  decision_mode: DecisionMode;
  priority_order: string[];
};

export type QbDecision = {
  routing: RoutingDecision;
  confidence: number; // 0-1
  reason: string;

  // research
  needsResearch: boolean;
  researchReason?: string;
  researchQueries: string[];
};

function lastUserText(messages: ChatMessage[]) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function clamp01(n: any): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function isInIcpContext(messages: ChatMessage[]) {
  const recent = (messages ?? []).slice(-10);
  const blob = recent.map((m) => `${m.role}: ${m.content}`).join("\n").toLowerCase();

  const cues = [
    "icp",
    "fit verdict",
    "not icp",
    "score",
    "tier",
    "tldr",
    "prospect",
    "hospital",
    "data gaps",
    "critical",
    "confidence",
  ];

  return cues.some((c) => blob.includes(c));
}

function looksLikeTargetAccountName(input: string) {
  const s = (input ?? "").trim();
  if (!s) return false;

  if (s.includes("?")) return false;
  if (s.length > 180) return false;

  const lowered = s.toLowerCase();
  const badStarts = [
    "how do",
    "can you",
    "what is",
    "what are",
    "help me",
    "explain",
    "write",
    "draft",
    "summarize",
    "make",
    "build",
    "fix",
    "debug",
  ];
  if (badStarts.some((x) => lowered.startsWith(x))) return false;

  if (/(https?:\/\/|www\.)/i.test(s)) return false;

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 12) return false;

  const punctCount = (s.match(/[.,;:]/g) ?? []).length;
  if (punctCount >= 4) return false;

  if (!/[a-zA-ZÀ-ÿ]/.test(s)) return false;

  return true;
}

function looksLikeFollowUp(input: string) {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return false;

  const patterns = [
    "not sure",
    "how can we find out",
    "how do we find out",
    "how do i find out",
    "can we confirm",
    "how to confirm",
    "where to check",
    "what about",
    "ok",
    "thanks",
    "got it",
    "makes sense",
    "next",
    "continue",
  ];

  return patterns.some((p) => s.includes(p));
}

function followUpLooksIcpRelevant(input: string) {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return false;

  const cues = [
    "tps",
    "equipment",
    "volume",
    "cases",
    "tier",
    "score",
    "confidence",
    "data gap",
    "gaps",
    "disqual",
    "disqualifier",
    "qualify",
    "qualification",
    "pursue",
    "target",
    "champion",
    "who should we talk to",
    "next question",
    "assumption",
    "re-score",
    "rescore",
  ];

  return cues.some((c) => s.includes(c));
}

function normalizeDecisionMode(x: any): DecisionMode {
  if (x === "rules" || x === "judgment" || x === "council" || x === "escalation") return x;
  return "judgment";
}

function normalizeRouting(x: any): RoutingDecision {
  const agents = Array.isArray(x?.agents_to_call) ? x.agents_to_call.map(String) : [];
  const prio = Array.isArray(x?.priority_order) ? x.priority_order.map(String) : agents;
  const mode = normalizeDecisionMode(x?.decision_mode);

  if (!agents.length) {
    return { agents_to_call: ["chat"], decision_mode: mode, priority_order: ["chat"] };
  }
  return { agents_to_call: agents, decision_mode: mode, priority_order: prio.length ? prio : agents };
}

export async function decideRouteWithQb(args: {
  messages: ChatMessage[];
  decisionContext?: any;
  entityData?: any;
}): Promise<QbDecision> {
  const { messages, decisionContext, entityData } = args;
  const last = lastUserText(messages);

  let routing: RoutingDecision = {
    agents_to_call: ["chat"],
    decision_mode: "rules",
    priority_order: ["chat"],
  };

  let confidence = 0;
  let reason = "";

  // --- HARD ROUTES ---
  if (isInIcpContext(messages) && looksLikeFollowUp(last) && followUpLooksIcpRelevant(last)) {
    routing = { agents_to_call: ["icpFit", "salesStrategy"], decision_mode: "rules", priority_order: ["icpFit", "salesStrategy"] };
    confidence = 0.9;
    reason = "Continuity: ICP-relevant follow-up within active ICP context.";
  } else if (looksLikeTargetAccountName(last)) {
    routing = { agents_to_call: ["icpFit", "salesStrategy"], decision_mode: "rules", priority_order: ["icpFit", "salesStrategy"] };
    confidence = 0.9;
    reason = "Heuristic: latest message looks like a target account name.";
  } else if (shouldRunIcpFit(messages)) {
    routing = { agents_to_call: ["icpFit", "salesStrategy"], decision_mode: "judgment", priority_order: ["icpFit", "salesStrategy"] };
    confidence = 0.82;
    reason = "Keyword heuristic: user appears to be requesting ICP fit scoring.";
  } else {
    // --- Router Agent (LLM) ---
    const routerAgent = loadRouterAgent();

    const recent = (messages ?? []).slice(-10);
    const convo = recent.map((m) => `${m.role}: ${m.content}`).join("\n");

    const user = [
      `Conversation (recent):\n${convo}`,
      ``,
      `Latest user message:\n${last}`,
      ``,
      `Decision Context:\n${JSON.stringify(decisionContext ?? {}, null, 2)}`,
      ``,
      `Entity Data:\n${JSON.stringify(entityData ?? {}, null, 2)}`,
      ``,
      `Return ONLY JSON matching the schema in the system prompt.`,
    ].join("\n");

    const llm = await callClaude({
      system: routerAgent.systemPrompt,
      messages: [{ role: "user", content: user }],
      json: true,
      maxTokens: 300,
    });

    if (!llm.ok) {
      routing = { agents_to_call: ["chat"], decision_mode: "judgment", priority_order: ["chat"] };
      confidence = 0;
      reason = llm.error ?? "RouterAgent routing failed";
    } else {
      const raw = (llm.text ?? "").trim();
      const jsonStr = extractFirstJsonObject(raw) ?? raw;

      let parsed: any = null;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = null;
      }

      routing = normalizeRouting(parsed);

      // If router didn't provide confidence, default
      const inferred = parsed?.confidence;
      confidence = inferred === undefined ? 0.65 : clamp01(inferred);
      reason = String(parsed?.reason ?? "RouterAgent decision");

      const choseIcp = routing.agents_to_call.includes("icpFit");
      if (choseIcp && confidence < 0.7) {
        routing = { agents_to_call: ["chat"], decision_mode: "judgment", priority_order: ["chat"] };
        reason = reason ? `${reason} (downgraded: confidence < 0.70)` : "Downgraded: confidence < 0.70";
      }
    }
  }

  // --- Research decision (unchanged) ---
  const r = await decideResearchWithClaude({ messages });

  if (!r.ok) {
    return {
      routing,
      confidence,
      reason,
      needsResearch: false,
      researchReason: `researchRouter failed: ${r.error}`,
      researchQueries: [],
    };
  }

  return {
    routing,
    confidence,
    reason,
    needsResearch: Boolean(r.decision.needs_research),
    researchReason: r.decision.reason,
    researchQueries: r.decision.queries ?? [],
  };
}
