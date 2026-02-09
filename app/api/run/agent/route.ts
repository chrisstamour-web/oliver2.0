// app/api/run/agent/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RunAgentPayload = {
  // keep shape flexible for now
  input: Record<string, any>;
};

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  // ✅ require auth (matches your other routes)
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as RunAgentPayload;

  if (!body?.input) {
    return NextResponse.json({ ok: false, error: "input required" }, { status: 400 });
  }

  // 1) Load KB (global only for now)
  const { data: kb, error: kbErr } = await supabase
    .from("kb_items")
    .select("id,title,summary,content_md,tenant_id")
    .is("tenant_id", null)
    .order("notion_last_edited_time", { ascending: false })
    .limit(30);

  if (kbErr) {
    console.warn("KB load failed", kbErr);
  }

  // 2) Call Claude with a base system prompt + KB context
  const claudeRes = await callClaude({
    systemPrompt: buildOliverSystemPrompt(kb ?? []),
    userInput: body.input,
  });

  return NextResponse.json({
    ok: true,
    result: claudeRes,
  });
}

function buildOliverSystemPrompt(kb: Array<any>) {
  const kbText = kb
    .map((k) => {
      const title = k.title ?? "Untitled";
      const summary = k.summary ? `\nSummary: ${k.summary}` : "";
      const body = k.content_md ? `\n${k.content_md}` : "";
      return `---\nTITLE: ${title}${summary}${body}\n`;
    })
    .join("\n");

  return `
You are Oliver, a chat-first sales copilot.
You give decisive, actionable recommendations inside the chat UI.
Users will ask natural questions (e.g., “should we go after this account?”, “who should I contact?”, “draft this email”).
You do NOT talk about “artifacts” or internal frameworks unless the user asks.

Use the following internal knowledge base as guidance. If knowledge conflicts with the user’s instructions, follow the user.

INTERNAL KNOWLEDGE BASE:
${kbText}
`.trim();
}

/* ---------------- Claude call ---------------- */

async function callClaude(args: { systemPrompt: string; userInput: any }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 2000,
      temperature: 0.2,
      system: args.systemPrompt,
      messages: [
        {
          role: "user",
          content: JSON.stringify(args.userInput),
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude error: ${text}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  return { text, raw: data };
}
