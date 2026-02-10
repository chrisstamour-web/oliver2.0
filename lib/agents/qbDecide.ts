// src/lib/agents/qbDecide.ts
import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadMainAgent } from "@/lib/agents/mainAgent";

export type QbDecision = {
  route: "icpFit" | "chat";
  needsResearch: boolean;
  researchQuery?: string;
  confidence: number; // 0-1
  reason: string;
};

function lastUserText(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

export async function qbDecide(messages: ChatMessage[]): Promise<QbDecision> {
  const qb = loadMainAgent();
  const last = lastUserText(messages);

  const system = `${qb.systemPrompt}

You are acting as the QUARTERBACK ORCHESTRATOR.

Decide TWO things:
1) Does the user's latest message require running the specialist ICP Fit scoring pipeline?
2) Does the user's latest message require external research (Perplexity/web lookup) BEFORE answering?

Return ONLY JSON with this schema:
{
  "route": "chat" | "icpFit",
  "needsResearch": boolean,
  "researchQuery": string | null,
  "confidence": number,
  "reason": string
}

Rules:
- route="icpFit" only if user is asking to score/qualify a prospect against ICP / "is this a fit?"
- needsResearch=true only if answering well requires external factual lookup OR up-to-date info.
- If needsResearch=true, set researchQuery to the best concise query to run. Otherwise null.
- If ambiguous, default to route="chat" and needsResearch=false unless confidence >= 0.70.
`;

  const user = `Latest user message:
${last}

Return ONLY JSON.`;

  const llm = await callClaude({
    system,
    messages: [{ role: "user", content: user }],
    json: true,
    maxTokens: 220,
  });

  if (!llm.ok) {
    return {
      route: "chat",
      needsResearch: false,
      researchQuery: undefined,
      confidence: 0,
      reason: llm.error ?? "qbDecide failed",
    };
  }

  const raw = (llm.text ?? "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      route: "chat",
      needsResearch: false,
      researchQuery: undefined,
      confidence: 0,
      reason: "qbDecide returned invalid JSON",
    };
  }

  const confidence =
    typeof parsed?.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;

  const route = parsed?.route === "icpFit" ? "icpFit" : "chat";
  const needsResearch = Boolean(parsed?.needsResearch);

  const researchQueryRaw =
    typeof parsed?.researchQuery === "string" ? parsed.researchQuery.trim() : "";

  // enforce your ambiguity rule
  if (route === "icpFit" && confidence < 0.7) {
    return {
      route: "chat",
      needsResearch,
      researchQuery: needsResearch ? researchQueryRaw || undefined : undefined,
      confidence,
      reason: String(parsed?.reason ?? "low confidence for icpFit"),
    };
  }

  return {
    route,
    needsResearch,
    researchQuery: needsResearch ? researchQueryRaw || undefined : undefined,
    confidence,
    reason: String(parsed?.reason ?? ""),
  };
}
