// src/lib/agents/router.ts
import type { ChatMessage } from "@/lib/llm/types";

export function shouldRunIcpFit(messages: ChatMessage[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const t = last.toLowerCase();

  // Keep it simple and conservative at first
  return (
    t.includes("icp") ||
    t.includes("ideal customer") ||
    t.includes("fit score") ||
    t.includes("is this a fit") ||
    t.includes("score this") ||
    t.includes("how good of a fit") ||
    t.includes("qualify this account")
  );
}
