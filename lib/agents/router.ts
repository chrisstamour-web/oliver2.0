import type { ChatMessage } from "@/lib/llm/types";
import type { RunnerId } from "@/lib/runners/registry";

function lastUserText(messages: ChatMessage[]) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

function hasAny(s: string, parts: string[]) {
  return parts.some((p) => s.includes(p));
}

export type RunPlan = {
  calls: RunnerId[]; // ordered
  reason: string;
};

export function routeRunners(messages: ChatMessage[]): RunPlan {
  const t = String(lastUserText(messages) ?? "").trim().toLowerCase();
  if (!t) return { calls: [], reason: "empty_input" };

  // Avoid false positives: subscription/pricing tiers
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
  if (hasAny(t, negativeTierContext)) {
    return { calls: [], reason: "tier_billing_context" };
  }

  const strongIcp = [
    "is this a fit",
    "fit score",
    "score this",
    "qualify this account",
    "should we pursue",
    "ideal customer",
    "ideal client",
    "icp fit",
    "not icp",
  ];
  const mentionsIcpWord = /\bicp\b/.test(t);

  const wantsStakeholders = hasAny(t, [
    "who should i talk to",
    "stakeholder",
    "buying committee",
    "decision maker",
    "who approves",
    "procurement",
    "champion",
    "cfo",
    "cio",
    "cmio",
  ]);

  const wantsOutreach = hasAny(t, [
    "email",
    "outreach",
    "message",
    "linkedin",
    "cold email",
    "intro",
    "draft",
  ]);

  const calls: RunnerId[] = [];

  if (
    hasAny(t, strongIcp) ||
    (mentionsIcpWord && hasAny(t, ["fit", "score", "qualify", "target", "prospect"]))
  ) {
    calls.push("icpFit");
  }

  if (wantsStakeholders) {
    calls.push("stakeholderMapping");
  }

  if (wantsOutreach) {
    calls.push("draftOutreach");
  }

  const wantsStrategy = hasAny(t, [
    "sales strategy",
    "next steps",
    "how do we win",
    "deal strategy",
    "positioning",
  ]);
  if (wantsStrategy) calls.push("salesStrategy");

  const uniq = Array.from(new Set(calls));
  return { calls: uniq, reason: uniq.length ? "matched_intent" : "no_specialist_needed" };
}

/**
 * ✅ This is what qbRouter expects.
 * It simply reuses routeRunners() so you don't maintain logic twice.
 */
export function shouldRunIcpFit(messages: ChatMessage[]): boolean {
  return routeRunners(messages).calls.includes("icpFit");
}
