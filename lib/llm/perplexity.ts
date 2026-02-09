import type { ChatMessage, ResearchResult } from "./types";

const PPLX_API_URL = "https://api.perplexity.ai/chat/completions";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Perplexity is OpenAI-compatible for chat completions.
 * We'll request citations (if supported by the chosen model/account) and return the raw response too.
 */
export async function callPerplexity(args: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}): Promise<ResearchResult> {
  try {
    const apiKey = mustGetEnv("PERPLEXITY_API_KEY");
    const model = args.model ?? process.env.PERPLEXITY_MODEL ?? "sonar";
    const max_tokens = args.maxTokens ?? 900;

    const res = await fetch(PPLX_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
        // Some Perplexity configs support returning citations automatically.
        // Leaving this "light" and compatible; raw will still include any citations.
        temperature: 0.2,
      }),
    });

    const raw = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        answer: "",
        raw,
        error: raw?.error?.message ?? `Perplexity error: ${res.status}`,
      };
    }

    const answer =
      raw?.choices?.[0]?.message?.content ??
      raw?.choices?.[0]?.delta?.content ??
      "";

    // If citations are present, normalize them lightly. (Many responses include a citations array.)
    const citations = Array.isArray(raw?.citations)
      ? raw.citations.map((c: any) => ({ title: c?.title, url: c?.url }))
      : undefined;

    return { ok: true, answer, citations, raw };
  } catch (e: any) {
    return { ok: false, answer: "", error: e?.message ?? "Perplexity unknown error" };
  }
}
