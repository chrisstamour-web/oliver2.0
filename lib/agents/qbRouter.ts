// src/lib/agents/qbRouter.ts
import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadMainAgent } from "@/lib/agents/mainAgent";
import { decideResearchWithClaude } from "@/lib/agents/researchRouter";

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
  for (let i = messages.length - 1; i >= 0; i--) {
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

export async function decideRouteWithQb(messages: ChatMessage[]): Promise<QbDecision> {
  const qb = loadMainAgent();
  const last = lastUserText(messages);

  // 1) QB decides route (chat vs icpFit)
  const system = `${qb.systemPrompt}

You are acting as the QUARTERBACK router.
Your job is to decide whether the user's latest request requires running the specialist ICP Fit pipeline.

Return ONLY JSON with this schema:
{
  "route": "chat" | "icpFit",
  "confidence": number,
  "reason": string
}

Routing rules:
- route = "icpFit" when the user is asking to score/qualify a company/account against ICP, or asking "is this a fit".
- route = "chat" for everything else.
- If ambiguous, prefer "chat" unless confidence >= 0.70.
`;

  const user = `Latest user message:
${last}

Return ONLY JSON.`;

  const llm = await callClaude({
    system,
    messages: [{ role: "user", content: user }],
    json: true,
    maxTokens: 200,
  });

  if (!llm.ok) {
    return {
      route: "chat",
      confidence: 0,
      reason: llm.error ?? "QB routing failed",
      needsResearch: false,
      researchQueries: [],
    };
  }

  const raw = (llm.text ?? "").trim();
  const jsonStr = extractFirstJsonObject(raw) ?? raw;

  let parsed: any = null;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      route: "chat",
      confidence: 0,
      reason: "QB returned invalid JSON",
      needsResearch: false,
      researchQueries: [],
    };
  }

  const route: QbRoute = parsed?.route === "icpFit" ? "icpFit" : "chat";
  const confidence =
    typeof parsed?.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;

  // enforce your ambiguity rule
  const finalRoute: QbRoute = route === "icpFit" && confidence < 0.7 ? "chat" : route;

  // 2) QB decides research (only if we're NOT running icpFit)
  // (You can change this later if you want research to support icpFit too.)
  if (finalRoute === "icpFit") {
    return {
      route: "icpFit",
      confidence,
      reason: String(parsed?.reason ?? ""),
      needsResearch: false,
      researchQueries: [],
    };
  }

  const r = await decideResearchWithClaude({ messages });

  if (!r.ok) {
    return {
      route: "chat",
      confidence,
      reason: String(parsed?.reason ?? ""),
      needsResearch: false,
      researchReason: `researchRouter failed: ${r.error}`,
      researchQueries: [],
    };
  }

  return {
    route: "chat",
    confidence,
    reason: String(parsed?.reason ?? ""),
    needsResearch: Boolean(r.decision.needs_research),
    researchReason: r.decision.reason,
    researchQueries: r.decision.queries ?? [],
  };
}
