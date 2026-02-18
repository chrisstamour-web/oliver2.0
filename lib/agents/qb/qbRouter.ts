// src/lib/agents/qb/qbRouter.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { decideResearchWithClaude } from "@/lib/agents/qb/researchRouter";
import { routeRunners } from "@/lib/agents/router";
import { loadRouterAgent } from "@/lib/runners/routerAgent";
import { RUNNERS } from "@/lib/runners/registry";

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

// Registry-backed allowlist (single source of truth)
const KNOWN_AGENT_IDS = new Set<string>(["chat", ...Object.keys(RUNNERS)]);

// -----------------------------
// Helpers
// -----------------------------
function lastUserText(messages: ChatMessage[]) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return String(messages[i]?.content ?? "");
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

function dedupeKeepOrder(arr: unknown[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// Back-compat + router-agent snake_case support
function normalizeAgentId(id: unknown): string {
  const s = String(id ?? "").trim();
  if (!s) return "";

  // legacy
  if (s === "stakeholderMap") return "stakeholderMapping";

  // routerAgent.md allowed ids (snake_case)
  if (s === "icp_fit") return "icpFit";
  if (s === "sales_strategy") return "salesStrategy";
  if (s === "stakeholder_map") return "stakeholderMapping";
  if (s === "draft_outreach") return "draftOutreach";

  // these may exist later, but not in registry today -> will be filtered out
  if (s === "recommended_assets") return "recommendedAssets";
  if (s === "risk_assessment") return "riskAssessment";

  return s;
}

function normalizeDecisionMode(x: any): DecisionMode {
  if (x === "rules" || x === "judgment" || x === "council" || x === "escalation") return x;
  return "judgment";
}

function normalizeRouting(x: any): RoutingDecision {
  const agentsRaw = Array.isArray(x?.agents_to_call) ? x.agents_to_call : [];
  const prioRaw = Array.isArray(x?.priority_order) ? x.priority_order : agentsRaw;

  const mode = normalizeDecisionMode(x?.decision_mode);

  const agents = dedupeKeepOrder(agentsRaw.map(normalizeAgentId), 8).filter((id) =>
    KNOWN_AGENT_IDS.has(id)
  );

  const prio = dedupeKeepOrder(prioRaw.map(normalizeAgentId), 8).filter((id) =>
    KNOWN_AGENT_IDS.has(id)
  );

  if (!agents.length) {
    return { agents_to_call: ["chat"], decision_mode: mode, priority_order: ["chat"] };
  }

  // ensure priority is a subset of agents (and non-empty)
  const finalPrio = prio.length ? prio.filter((id) => agents.includes(id)) : agents;

  return {
    agents_to_call: agents,
    decision_mode: mode,
    priority_order: finalPrio.length ? finalPrio : agents,
  };
}

function decisionModeFromCount(n: number): DecisionMode {
  if (n <= 1) return "rules";
  if (n === 2) return "judgment";
  if (n === 3) return "council";
  return "escalation";
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

// -----------------------------
// Research enforcement helpers
// -----------------------------
function uniqNonEmptyStrings(v: unknown, max = 8): string[] {
  return dedupeKeepOrder(Array.isArray(v) ? v : [], max);
}

function defaultResearchQueriesFromUserText(userText: string): string[] {
  const t = (userText ?? "").trim();
  if (!t) return [];

  return [
    `${t} leadership team`,
    `${t} quality patient safety director`,
    `${t} innovation office technology assessment`,
    `${t} procurement contact`,
    `${t} directory email`,
  ];
}

function enforceResearchRule(input: {
  lastUser: string;
  needsResearch: boolean;
  researchQueries: unknown;
  researchReason?: string;
}): { needsResearch: boolean; researchQueries: string[]; researchReason?: string } {
  const { lastUser } = input;

  let needsResearch = Boolean(input.needsResearch);
  let researchQueries = uniqNonEmptyStrings(input.researchQueries, 8);
  let researchReason = input.researchReason;

  if (!needsResearch) {
    return { needsResearch: false, researchQueries: [], researchReason };
  }

  // ✅ NON-NEGOTIABLE: needsResearch => at least 3 queries
  if (researchQueries.length >= 3) {
    return { needsResearch: true, researchQueries, researchReason };
  }

  const fallback = defaultResearchQueriesFromUserText(lastUser);
  researchQueries = uniqNonEmptyStrings([...researchQueries, ...fallback], 8);

  if (researchQueries.length >= 3) {
    researchReason = researchReason
      ? `${researchReason} (auto-filled missing researchQueries)`
      : "Auto-filled missing researchQueries (QB enforcement).";
    return { needsResearch: true, researchQueries, researchReason };
  }

  return {
    needsResearch: false,
    researchQueries: [],
    researchReason: researchReason
      ? `${researchReason} (disabled: insufficient researchQueries)`
      : "Disabled research: insufficient researchQueries.",
  };
}

// -----------------------------
// Main QB decision
// -----------------------------
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

  let confidence = 0.5;
  let reason = "Default route";

  // --- HARD ROUTES ---
  if (isInIcpContext(messages) && looksLikeFollowUp(last) && followUpLooksIcpRelevant(last)) {
    routing = {
      agents_to_call: ["icpFit", "salesStrategy"],
      decision_mode: "judgment",
      priority_order: ["icpFit", "salesStrategy"],
    };
    confidence = 0.9;
    reason = "Continuity: ICP-relevant follow-up within active ICP context.";
  } else if (looksLikeTargetAccountName(last)) {
    routing = {
      agents_to_call: ["icpFit", "salesStrategy"],
      decision_mode: "judgment",
      priority_order: ["icpFit", "salesStrategy"],
    };
    confidence = 0.9;
    reason = "Heuristic: latest message looks like a target account name.";
  } else {
    // --- HEURISTIC ROUTER (your TS router) ---
    const plan = routeRunners(messages);
    const calls = (plan?.calls ?? []).map(normalizeAgentId).filter((id) => KNOWN_AGENT_IDS.has(id));

    if (calls.length) {
      // Decide mode based on how many specialists we plan to call
      const mode = decisionModeFromCount(calls.length);

      routing = {
        agents_to_call: calls,
        decision_mode: mode,
        priority_order: calls,
      };

      confidence = calls.length >= 2 ? 0.8 : 0.72;
      reason = `routeRunners: ${plan.reason || "matched_intent"} (${calls.join(", ")})`;
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
        confidence = 0.3;
        reason = llm.error ?? "RouterAgent routing failed";
      } else {
        const raw = String(llm.text ?? "").trim();
        const jsonStr = extractFirstJsonObject(raw) ?? raw;

        let parsed: any = null;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          parsed = null;
        }

        routing = normalizeRouting(parsed);
        confidence = 0.62;
        reason = `RouterAgent decision (mode=${routing.decision_mode}, agents=${routing.agents_to_call.join(", ")})`;

        // Safety: if router picked nothing meaningful, fall back to chat
        if (!routing.agents_to_call?.length) {
          routing = { agents_to_call: ["chat"], decision_mode: "judgment", priority_order: ["chat"] };
          confidence = 0.3;
          reason = "RouterAgent returned no runnable agents; fallback to chat.";
        }
      }
    }
  }

  // Final safety: ensure routing is registry-valid
  routing = normalizeRouting(routing);

  // --- Research decision (separate QB subsystem) ---
  const r = await decideResearchWithClaude({ messages });

  if (!r.ok) {
    return {
      routing,
      confidence: clamp01(confidence),
      reason,
      needsResearch: false,
      researchReason: `researchRouter failed: ${r.error}`,
      researchQueries: [],
    };
  }

  const enforced = enforceResearchRule({
    lastUser: last,
    needsResearch: Boolean(r.decision.needs_research),
    researchReason: r.decision.reason,
    researchQueries: r.decision.queries ?? [],
  });

  return {
    routing,
    confidence: clamp01(confidence),
    reason,
    needsResearch: enforced.needsResearch,
    researchReason: enforced.researchReason,
    researchQueries: enforced.researchQueries,
  };
}
