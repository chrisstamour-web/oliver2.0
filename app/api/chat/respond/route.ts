import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { loadMainAgent } from "@/lib/agents/mainAgent";
import { callClaude } from "@/lib/llm/claude";
import type { ChatMessage } from "@/lib/llm/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { supabase, tenantId } = await getTenantIdOrThrow();

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const threadId = body?.threadId;

  if (!threadId || typeof threadId !== "string") {
    return NextResponse.json({ ok: false, error: "threadId required" }, { status: 400 });
  }

  const { data: rows, error: mErr } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("tenant_id", tenantId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (mErr) {
    return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
  }

  const agent = loadMainAgent();

  // ✅ Force correct typing so callClaude() accepts it
  const messages: ChatMessage[] = (rows ?? []).map((m: any) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? ""),
  }));

  const llm = await callClaude({
    system: agent.systemPrompt,
    messages,
  });

  if (!llm.ok) {
    return NextResponse.json(
      { ok: false, error: llm.error ?? "Claude failed" },
      { status: 502 }
    );
  }

  const assistantText = (llm.text ?? "").trim();
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

  return NextResponse.json({ ok: true });
}
