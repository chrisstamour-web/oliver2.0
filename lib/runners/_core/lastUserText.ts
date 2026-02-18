import "server-only";
import type { ChatMessage } from "@/lib/llm/types";

export function lastUserText(messages: ChatMessage[]): string {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}
