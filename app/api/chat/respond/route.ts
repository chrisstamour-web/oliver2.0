// app/api/chat/respond/route.ts
import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { loadMainAgent } from "@/lib/agents/mainAgent";
import { callClaude } from "@/lib/llm/claude";
import type { ChatMessage } from "@/lib/llm/types";

import { decideRouteWithQb } from "@/lib/agents/qbRouter";
import { runIcpFit } from "@/lib/agents/icpFit";
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

    // --- QB decides (route + research) ---
    const decision = await decideRouteWithQb(messages);

    // --- ICP Fit path ---
    if (decision.route === "icpFit") {
      const result = await runIcpFit({ tenantId, messages });
      const assistantText = JSON.stringify(result.content_json, null, 2);

      const { error: insErr } = await supabase.from("chat_messages").insert({
        tenant_id: tenantId,
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
      });

      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, route: "icpFit", confidence: decision.confidence });
    }

    // --- Optional Perplexity research (chat path only) ---
    let researchMsg: ChatMessage | null = null;

    if (decision.needsResearch && (decision.researchQueries?.length ?? 0) > 0) {
      const pplx = await callPerplexity({
        messages: buildPerplexityMessages(decision.researchQueries),
      });

      if (pplx.ok) {
        const block = formatResearchBlock({
          answer: pplx.answer,
          citations: pplx.citations,
        });

        // Inject as assistant context message so we don't bloat system prompt
        researchMsg = { role: "assistant", content: block };
      }
    }

    // --- KB retrieval (chat path) ---
    const lastUser = lastUserText(messages);
    const kbHits = lastUser ? await searchKb({ tenantId, query: lastUser, limit: 6 }) : [];
    const kbBlock = formatKbBlock(kbHits);

    const kbMsg: ChatMessage | null = kbBlock
      ? { role: "assistant", content: kbBlock }
      : null;

    // --- normal chat path (QB main agent) ---
    const agent = loadMainAgent();

    const augmented: ChatMessage[] = [
      ...messages,
      ...(researchMsg ? [researchMsg] : []),
      ...(kbMsg ? [kbMsg] : []),
    ];

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
      usedResearch: Boolean(researchMsg),
      usedKb: Boolean(kbMsg),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
