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
    const model = args.model ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";
    const max_tokens = args.maxTokens ?? 900;

    // Anthropic "messages" payload expects role=user|assistant messages
    // System prompt is provided separately.
    const messages = args.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        // required version header per Anthropic docs
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system: args.system ?? "",
        messages,
      }),
    });

    const raw = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        text: "",
        raw,
        error: raw?.error?.message ?? `Claude error: ${res.status}`,
      };
    }

    // Claude response content is an array of blocks; we grab text blocks
    const text =
      Array.isArray(raw?.content)
        ? raw.content
            .filter((b: any) => b?.type === "text")
            .map((b: any) => b.text)
            .join("\n")
        : "";

    return { ok: true, text, raw };
  } catch (e: any) {
    return { ok: false, text: "", error: e?.message ?? "Claude unknown error" };
  }
}
