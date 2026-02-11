import type { ChatMessage, ResearchResult } from "./types";

const PPLX_API_URL = "https://api.perplexity.ai/chat/completions";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeCitations(raw: any): { title?: string; url?: string }[] | undefined {
  const candidates =
    raw?.citations ??
    raw?.choices?.[0]?.citations ??
    raw?.choices?.[0]?.message?.citations ??
    raw?.choices?.[0]?.message?.metadata?.citations ??
    undefined;

  if (!Array.isArray(candidates)) return undefined;

  return candidates
    .map((c: any) => ({
      title: c?.title ?? c?.name ?? undefined,
      url: c?.url ?? c?.link ?? undefined,
    }))
    .filter((c: any) => c.title || c.url)
    .slice(0, 12);
}

/**
 * Perplexity is OpenAI-compatible for chat completions.
 * We'll request citations (if supported by the chosen model/account) and return the raw response too.
 */
export async function callPerplexity(args: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<ResearchResult> {
  try {
    const apiKey = mustGetEnv("PERPLEXITY_API_KEY");
    const model = args.model ?? process.env.PERPLEXITY_MODEL ?? "sonar";
    const max_tokens = args.maxTokens ?? 900;
    const temperature = typeof args.temperature === "number" ? args.temperature : 0.2;

    // Hard timeout to avoid hanging requests
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45_000);

    const res = await fetch(PPLX_API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature,
      }),
    }).finally(() => clearTimeout(t));

    // Safely parse JSON (Perplexity can return non-JSON on some edge failures)
    let raw: any = {};
    try {
      raw = await res.json();
    } catch {
      raw = { error: { message: "Non-JSON response from Perplexity" } };
    }

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

    const citations = normalizeCitations(raw);

    return { ok: true, answer, citations, raw };
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Perplexity request timed out"
        : e?.message ?? "Perplexity unknown error";

    return { ok: false, answer: "", error: msg };
  }
}
