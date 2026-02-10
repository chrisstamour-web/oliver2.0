// lib/agents/router.ts
import type { ChatMessage } from "@/lib/llm/types";

function lastUserText(messages: ChatMessage[]) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

function hasAny(s: string, parts: string[]) {
  return parts.some((p) => s.includes(p));
}

export function shouldRunIcpFit(messages: ChatMessage[]): boolean {
  const last = lastUserText(messages);
  const t = String(last ?? "").trim().toLowerCase();
  if (!t) return false;

  // Avoid false positives: subscription/pricing tiers, SaaS plan tiers, etc.
  const negativeTierContext = [
    "pricing tier",
    "plan tier",
    "subscription tier",
    "billing tier",
    "enterprise tier",
    "pro tier",
    "starter tier",
    "free tier",
    "tier list",
    "tiered pricing",
  ];
  if (hasAny(t, negativeTierContext)) return false;

  // Strong intent phrases (almost always ICP Fit)
  const strongIntents = [
    "is this a fit",
    "is it a fit",
    "fit score",
    "score this",
    "score them",
    "qualify this account",
    "qualify this",
    "should we pursue",
    "should we go after",
    "good target",
    "ideal customer",
    "ideal client",
    "icp fit",
    "not icp",
  ];
  if (hasAny(t, strongIntents)) return true;

  // If they say "ICP" explicitly, require some nearby intent/context.
  // Use word boundary so "topic" doesn't match "icp".
  const mentionsIcpWord = /\bicp\b/.test(t);
  if (mentionsIcpWord) {
    const icpContext = [
      "fit",
      "score",
      "tier",
      "qualify",
      "pursue",
      "target",
      "prospect",
      "account",
    ];
    return hasAny(t, icpContext);
  }

  // "Tier" alone is too broad; only treat as ICP if paired with qualification language.
  if (t.includes("tier")) {
    const tierContext = ["icp", "fit", "score", "qualify", "pursue", "target", "prospect", "account"];
    return hasAny(t, tierContext);
  }

  return false;
}
