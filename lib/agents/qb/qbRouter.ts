// lib/agents/qb/qbRouter.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { decideResearchWithClaude } from "@/lib/agents/qb/researchRouter";
import { shouldRunIcpFit } from "@/lib/agents/router";

export type QbRoute = "chat" | "icpFit";

export type QbDecision = {
  route: QbRoute;
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

/**
 * Return true if the conversation recently appears to be in an ICP evaluation flow.
 * This prevents generic follow-ups from getting misrouted.
 */
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

/**
 * Deterministic heuristic: if the user typed what looks like a target account name,
 * route straight to ICP.
 */
function looksLikeTargetAccountName(input: string) {
  const s = (input ?? "").trim();
  if (!s) return false;

  // If it’s clearly a question / multi-sentence request, probably not just an account name
  if (s.includes("?")) return false;
  if (s.length > 180) return false;

  // avoid obvious non-org prompts
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

  // if it contains a URL, it's not an account name
  if (/(https?:\/\/|www\.)/i.test(s)) return false;

  // allow 1–12 words
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 12) return false;

  // If it has lots of punctuation, it’s probably a sentence
  const punctCount = (s.match(/[.,;:]/g) ?? []).length;
  if (punctCount >= 4) return false;

  // Must contain at least one letter
  if (!/[a-zA-ZÀ-ÿ]/.test(s)) return false;

  return true;
}

/**
 * Follow-up detector: short messages that often omit the entity name.
 */
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

/**
 * ICP-relevant follow-up detector: only keep routing to icpFit when the follow-up is
 * actually about qualification inputs / scoring / gaps, etc.
 */
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

/**
 * Dedicated, minimal router system prompt.
 * (Do NOT use mainAgent.md here — keep routing and chatting separate.)
 */
const ROUTER_SYSTEM = `
You are the QUARTERBACK router.

Return ONLY valid JSON with this exact schema:
{
  "route": "chat" | "icpFit",
  "confidence": number,
  "reason": string
}

Routing rules:
- route="icpFit" when the user is asking to score/qualify a company/account against ICP,
  or is effectively saying "is this a fit", "qualify", "score", "tier", "good target", "should we pursue".
- route="chat" for everything else.
- If ambiguous, prefer "chat" unless confidence >= 0.70.
`.trim();

export async function decideRouteWithQb(messages: ChatMessage[]): Promise<QbDecision> {
  const last = lastUserText(messages);

  // --- HARD ROUTES: cheapest + most reliable ---
  let route: QbRoute = "chat";
  let confidence = 0;
  let reason = "";

  // 1) Preserve ICP continuity ONLY on ICP-relevant follow-ups
  if (isInIcpContext(messages) && looksLikeFollowUp(last) && followUpLooksIcpRelevant(last)) {
    route = "icpFit";
    confidence = 0.9;
    reason = "Continuity: ICP-relevant follow-up within active ICP context.";
  }
  // 2) If user input looks like a target account name, run ICP fit
  else if (looksLikeTargetAccountName(last)) {
    route = "icpFit";
    confidence = 0.9;
    reason = "Heuristic: latest message looks like a target account name.";
  }
  // 3) If classic ICP phrasing is present (your keyword router)
  else if (shouldRunIcpFit(messages)) {
    route = "icpFit";
    confidence = 0.82;
    reason = "Keyword heuristic: user appears to be requesting ICP fit scoring.";
  }
  // --- SOFT ROUTE: Claude router only when unclear ---
  else {
    const user = `Latest user message:
${last}

Task: decide whether the user is naming a target account to qualify OR asking for ICP fit.

Return ONLY JSON.`;

    const llm = await callClaude({
      system: ROUTER_SYSTEM,
      messages: [{ role: "user", content: user }],
      json: true,
      maxTokens: 200,
    });

    if (!llm.ok) {
      route = "chat";
      confidence = 0;
      reason = llm.error ?? "QB routing failed";
    } else {
      const raw = (llm.text ?? "").trim();
      const jsonStr = extractFirstJsonObject(raw) ?? raw;

      let parsed: any = null;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = null;
      }

      route = parsed?.route === "icpFit" ? "icpFit" : "chat";
      confidence =
        typeof parsed?.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;
      reason = String(parsed?.reason ?? "");

      // enforce ambiguity rule for Claude-only decisions
      if (route === "icpFit" && confidence < 0.7) {
        route = "chat";
        reason = reason
          ? `${reason} (downgraded: confidence < 0.70)`
          : "Downgraded: confidence < 0.70";
      }
    }
  }

  // --- Research decision for BOTH routes ---
  const r = await decideResearchWithClaude({ messages });

  if (!r.ok) {
    return {
      route,
      confidence,
      reason,
      needsResearch: false,
      researchReason: `researchRouter failed: ${r.error}`,
      researchQueries: [],
    };
  }

  return {
    route,
    confidence,
    reason,
    needsResearch: Boolean(r.decision.needs_research),
    researchReason: r.decision.reason,
    researchQueries: r.decision.queries ?? [],
  };
}
