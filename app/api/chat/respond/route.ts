// app/api/chat/respond/route.ts
import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { loadMainAgent } from "@/lib/runners/mainAgent";
import { callClaude } from "@/lib/llm/claude";
import type { ChatMessage } from "@/lib/llm/types";

import { decideRouteWithQb } from "@/lib/agents/qb/qbRouter";
import { runIcpFit } from "@/lib/runners/icpFit";
import { callPerplexity } from "@/lib/llm/perplexity";

import { searchKb } from "@/lib/kb/searchKb";
import { formatKbBlock } from "@/lib/kb/formatKb";

export const runtime = "nodejs";

type Row = {
  role: string | null;
  content: string | null;
  created_at: string | null;
};

function normalizeMessages(rows: Row[]): ChatMessage[] {
  return (rows ?? []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? ""),
  }));
}

function lastUserText(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

function buildPerplexityMessages(queries: string[]): ChatMessage[] {
  const q = (queries ?? []).filter(Boolean).slice(0, 3).join("\n");
  const prompt = `Research the following. Be factual and include sources/citations when available.\n\n${q}`;
  return [{ role: "user", content: prompt }];
}

function formatResearchBlock(p: {
  answer?: string;
  citations?: { title?: string; url?: string }[];
}) {
  const lines: string[] = [];
  lines.push("[External Research — Perplexity]");
  if (p.answer) lines.push(p.answer.trim());

  if (p.citations?.length) {
    lines.push("\nCitations:");
    for (const c of p.citations.slice(0, 8)) {
      const t = (c.title ?? "").trim();
      const u = (c.url ?? "").trim();
      lines.push(`- ${t || "Source"}: ${u}`);
    }
  }

  return lines.join("\n");
}

function makeCacheKey(input: { route: string; queries: string[]; lastUser: string }) {
  const q = (input.queries ?? []).slice(0, 3).join("|");
  const u = (input.lastUser ?? "").slice(0, 200);
  return `route=${input.route}::q=${q}::u=${u}`;
}

async function getCachedResearch(supabase: any, tenantId: string, cacheKey: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("research_cache")
    .select("answer,citations,created_at")
    .eq("tenant_id", tenantId)
    .eq("cache_key", cacheKey)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

async function putCachedResearch(
  supabase: any,
  tenantId: string,
  cacheKey: string,
  payload: { answer?: string; citations?: any[] }
) {
  await supabase.from("research_cache").insert({
    tenant_id: tenantId,
    cache_key: cacheKey,
    provider: "perplexity",
    answer: payload.answer ?? null,
    citations: payload.citations ?? [],
  });
}

/**
 * QB handoff: short "QB Next" section to keep the conversation moving.
 */
async function qbHandoff(args: {
  lastUser: string;
  specialistOutput: string;
}): Promise<string> {
  const system = `You are the QUARTERBACK (QB).
Your job is to continue the conversation AFTER a specialist agent has delivered its output.

Output format:
**QB Next**
- 2–4 bullet next steps tailored to this exact situation
- 1 crisp next question

Rules:
- Do NOT repeat the specialist's content.
- Keep it short and action-oriented.
- Assume the same prospect remains in scope unless the user named a new one.
`;

  const user = `Last user message:
${args.lastUser}

Specialist output (for context only):
${args.specialistOutput}

Write the QB Next section.`;

  const llm = await callClaude({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 220,
  });

  if (!llm.ok) return "";
  const t = String(llm.text ?? "").trim();
  return t ? `\n\n${t}` : "";
}

export async function POST(req: Request) {
  try {
    const { supabase, tenantId } = await getTenantIdOrThrow();

    // --- auth ---
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // --- input ---
    const body = await req.json().catch(() => ({}));
    const threadId = body?.threadId;

    if (!threadId || typeof threadId !== "string") {
      return NextResponse.json({ ok: false, error: "threadId required" }, { status: 400 });
    }

    // =========================
    // CHANGE #1: Load thread row
    // =========================
    const { data: threadRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, account_id, title")
      .eq("tenant_id", tenantId)
      .eq("id", threadId)
      .maybeSingle();

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    // --- load messages ---
    const { data: rows, error: mErr } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("tenant_id", tenantId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const messages: ChatMessage[] = normalizeMessages((rows ?? []) as Row[]);
    const lastUser = lastUserText(messages);

    // ====================================
    // CHANGE #2: Load account + build msg
    // ====================================
    let accountMsg: ChatMessage | null = null;

    if (threadRow?.account_id) {
      const { data: acct, error: aErr } = await supabase
        .from("accounts")
        .select("id,name,metadata_json,updated_at")
        .eq("tenant_id", tenantId)
        .eq("id", threadRow.account_id)
        .maybeSingle();

      if (!aErr && acct) {
        const facts = acct.metadata_json ?? {};
        const factsPretty = JSON.stringify(facts, null, 2);

        accountMsg = {
          role: "assistant",
          content:
            `[Account Memory]\n` +
            `Account: ${acct.name}\n` +
            `Last updated: ${acct.updated_at ?? "unknown"}\n` +
            `Known facts (tenant-owned):\n${factsPretty}\n\n` +
            `Rules: Treat as context. Do not claim facts not present here.`,
        };
      }
    }

    // --- QB decides (route + research intent) ---
    const decision = await decideRouteWithQb(messages);
    const route = decision.route ?? "chat";

    // --- Perplexity research (cached) ---
    let researchMsg: ChatMessage | null = null;
    let usedResearch = false;

    if (decision.needsResearch && (decision.researchQueries?.length ?? 0) > 0) {
      const cacheKey = makeCacheKey({
        route,
        queries: decision.researchQueries ?? [],
        lastUser,
      });

      const cached = await getCachedResearch(supabase, tenantId, cacheKey);

      if (cached?.answer) {
        const block = formatResearchBlock({
          answer: cached.answer,
          citations: (cached.citations ?? []) as any[],
        });
        researchMsg = { role: "assistant", content: block };
        usedResearch = true;
      } else {
        const pplx = await callPerplexity({
          messages: buildPerplexityMessages(decision.researchQueries),
        });

        if (pplx.ok) {
          await putCachedResearch(supabase, tenantId, cacheKey, {
            answer: pplx.answer,
            citations: pplx.citations ?? [],
          });

          const block = formatResearchBlock({
            answer: pplx.answer,
            citations: pplx.citations,
          });
          researchMsg = { role: "assistant", content: block };
          usedResearch = true;
        }
      }
    }

    // --- KB retrieval (never fatal) ---
    let kbMsg: ChatMessage | null = null;
    let usedKb = false;

    try {
      if (lastUser) {
        const kbHits = await searchKb({ tenantId, query: lastUser, limit: 6 });
        const kbBlock = formatKbBlock(kbHits);
        if (kbBlock) {
          kbMsg = { role: "assistant", content: kbBlock };
          usedKb = true;
        }
      }
    } catch (e) {
      console.warn("KB search failed (continuing without KB):", e);
      kbMsg = null;
      usedKb = false;
    }

    // ==========================================
    // CHANGE #3: Augmented includes accountMsg
    // ==========================================
    const augmented: ChatMessage[] = [
      ...messages,
      ...(accountMsg ? [accountMsg] : []),
      ...(researchMsg ? [researchMsg] : []),
      ...(kbMsg ? [kbMsg] : []),
    ];

    // --- Sub-agent path: ICP Fit (natural output) ---
    if (route === "icpFit") {
      const result = await runIcpFit({ tenantId, messages: augmented });
      const icpText = String((result as any).content_text ?? "").trim();

      if (!icpText) {
        return NextResponse.json(
          { ok: false, error: "ICP Fit returned empty output" },
          { status: 500 }
        );
      }

      // QB takes over after specialist output
      const handoff = await qbHandoff({
        lastUser,
        specialistOutput: icpText,
      });

      const assistantText = icpText + handoff;

      const { error: insErr } = await supabase.from("chat_messages").insert({
        tenant_id: tenantId,
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
      });

      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        route: "icpFit",
        confidence: decision.confidence,
        usedResearch,
        usedKb,
      });
    }

    // --- Normal chat path (main agent) ---
    const agent = loadMainAgent();

    const llm = await callClaude({
      system: agent.systemPrompt,
      messages: augmented,
    });

    if (!llm.ok) {
      return NextResponse.json(
        { ok: false, error: llm.error ?? "Claude failed" },
        { status: 502 }
      );
    }

    const assistantText = String(llm.text ?? "").trim();
    if (!assistantText) {
      return NextResponse.json({ ok: false, error: "Empty model response" }, { status: 500 });
    }

    const { error: insErr } = await supabase.from("chat_messages").insert({
      tenant_id: tenantId,
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
    });

    if (insErr) {
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      route: "chat",
      confidence: decision.confidence,
      usedResearch,
      usedKb,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
