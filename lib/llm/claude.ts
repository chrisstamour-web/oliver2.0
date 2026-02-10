// lib/llm/claude.ts
import type { ChatMessage } from "./types";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function callClaude(args: {
  messages: ChatMessage[];
  system?: string;
  model?: string;
  maxTokens?: number;
}): Promise<{ ok: boolean; text: string; raw?: any; error?: string }> {
  try {
    const apiKey = mustGetEnv("ANTHROPIC_API_KEY");

    const model = args.model ?? process.env.CLAUDE_MODEL;
    if (!model) throw new Error("Missing env var: CLAUDE_MODEL");

    const max_tokens = args.maxTokens ?? 900;

    const messages = (args.messages ?? [])
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Hard timeout to avoid hanging requests
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45_000);

    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system: args.system ?? "",
        messages,
      }),
    }).finally(() => clearTimeout(t));

    const raw = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        text: "",
        raw,
        error: raw?.error?.message ?? `Claude error: ${res.status}`,
      };
    }

    const text =
      Array.isArray(raw?.content)
        ? raw.content
            .filter((b: any) => b?.type === "text")
            .map((b: any) => b.text)
            .join("\n")
        : "";

    return { ok: true, text, raw };
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Claude request timed out"
        : e?.message ?? "Claude unknown error";
    return { ok: false, text: "", error: msg };
  }
}
