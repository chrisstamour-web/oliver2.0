// app/api/chat/respond/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { loadMainAgent } from "@/lib/runners/mainAgent";
import { callClaude } from "@/lib/llm/claude";
import type { ChatMessage } from "@/lib/llm/types";

import { decideRouteWithQb } from "@/lib/agents/qb/qbRouter";

import { runIcpFit } from "@/lib/runners/icpFit";
import { runSalesStrategy } from "@/lib/runners/salesStrategy";
import { runStakeholderMapping } from "@/lib/runners/stakeholderMap";
import { runDraftOutreach } from "@/lib/runners/draftOutreach";

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

// -----------------------------
// Perplexity prompt construction
// -----------------------------
function buildPerplexityMessages(args: {
  target: string; // e.g. "Meadville Medical Center, Meadville, PA"
  extraQueries?: string[]; // route-specific hints
}): ChatMessage[] {
  const system = [
    `ROLE + OBJECTIVE (STRICT)`,
    `You are a hospital intelligence researcher.`,
    `Collect FACTS ONLY — no scoring, analysis, or recommendations.`,
    `Every claim MUST include a URL citation and, when possible, a short quote.`,
    ``,
    `EVIDENCE STANDARDS`,
    `- CONFIRMED: verified by 2+ primary sources`,
    `- ESTIMATED: inferred from proxies; explain proxies + reasoning`,
    `- UNKNOWN: not found after searching; list sources checked`,
    ``,
    `SOURCE PRIORITY (use in order)`,
    `1) Hospital official websites`,
    `2) LinkedIn profiles (current role at hospital)`,
    `3) PubMed/Google Scholar`,
    `4) Press releases (hospital/vendor)`,
    `5) Job postings`,
    `6) Conference abstracts (AAPM/ASTRO/ESTRO)`,
    `7) Local news`,
    `8) Government databases (e.g., cancer.gov, CMS)`,
    ``,
    `EXCLUDED SOURCES`,
    `- Wikipedia / general wikis`,
    `- unverified forums`,
    `- sales intelligence platforms (ZoomInfo/Apollo/etc.)`,
    `- sources older than 3 years for time-sensitive claims (unless only evidence)`,
    ``,
    `OUTPUT RULES`,
    `- Follow the schema exactly (single definition per field; NO duplication).`,
    `- Prefer last 24 months for staffing/equipment/software; include dates.`,
    `- If UNKNOWN, write UNKNOWN + sources checked.`,
  ].join("\n");

  const schema = `
HOSPITAL INTELLIGENCE REPORT
Hospital: ${args.target}

## 1. RADIATION ONCOLOGY INFRASTRUCTURE
TPS: Brand | Version (if Eclipse) | Evidence (URL + quote) | Confidence (CONFIRMED/ESTIMATED/UNKNOWN)
Linacs: Varian models + qty | Non-Varian | Installation dates | Evidence (URL + quote)
Staff: Physicists (count + names + LinkedIn URLs) | Dosimetrists | Rad Oncs | Method + Evidence URLs

## 2. CLINICAL VOLUME
Skin cancer volume: Explicit data OR estimate (bed count, NCI designation, dedicated program, physician subspecializations, reasoning, confidence) + Evidence URLs
Mohs + radiation partnership: Yes/No/Unknown + Evidence URL

## 3. INSTITUTIONAL CHARACTERISTICS
Type | NCI designation | Med school affiliation | Residency + Evidence URLs
Ownership | Reimbursement model (HOPD/Freestanding) | Health system + Evidence URLs
Financial signals: Capital investments (2yr) | Equipment purchases | Distress signals + Evidence URLs

## 4. KEY PERSONNEL
Chief Medical Physicist: Name, title, LinkedIn, email, background, AAPM chapter/leadership, publications (last 3yr, up to 5), LinkedIn activity (6mo) + Evidence URLs
Secondary: Rad Onc (skin), Dosimetry Mgr, Dept Admin, Procurement Dir — Name + LinkedIn + relevant details + Evidence URLs

## 5. TRIGGER EVENTS (Last 6 Months)
For each: Event | Date | Evidence (URL + quote)
- Equipment purchases/installations
- Tech upgrades
- Staffing changes (hires + open positions)
- LinkedIn pain signals
- Publications
- Strategic initiatives

## 6. WORKFLOW PAIN EVIDENCE
Job postings (last 12mo): Title | date | key language (quote) | URL
Abstracts/publications: Citation | relevance quote | URL

## 7. COMPETITIVE LANDSCAPE
Auto-planning | Auto-contouring | 3D bolus — name or "None detected" | evidence | contract timing (if found)
Vendor relationships | RFP/procurement activity + Evidence URLs

## 8. RELATIONSHIP MAPPING
Co-author networks | AAPM overlap | LinkedIn connections | Conference co-presentations + Evidence URLs

## DATA GAPS
Critical data NOT found + sources checked
3–5 discovery questions to fill gaps

## SOURCES CONSULTED
Complete URL list
`.trim();

  const extra = (args.extraQueries ?? []).filter(Boolean).slice(0, 5);
  const extraBlock = extra.length
    ? `\n\nADDITIONAL SEARCH QUERIES (use to guide your search):\n- ${extra.join("\n- ")}`
    : "";

  return [
    { role: "system", content: system },
    { role: "user", content: schema + extraBlock },
  ];
}
function formatResearchBlock(p: {
  answer?: string;
  citations?: { title?: unknown; url?: unknown }[];
}) {
  const lines: string[] = [];
  lines.push("[External Research — Perplexity]");
  if (p.answer) lines.push(String(p.answer).trim());

  if (p.citations?.length) {
    lines.push("\nCitations:");
    for (const c of p.citations.slice(0, 8)) {
      const t = String(c?.title ?? "").trim();

      // ✅ url can be string | string[] | object | null
      const rawUrl = (c as any)?.url;
      const url =
        typeof rawUrl === "string"
          ? rawUrl
          : Array.isArray(rawUrl)
          ? rawUrl.find((x) => typeof x === "string") ?? ""
          : "";

      lines.push(`- ${t || "Source"}: ${url.trim()}`);
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
  const citations = (payload.citations ?? [])
    .map((c: any) => {
      const rawTitle = c?.title;
      const rawUrl = c?.url;

      const title =
        typeof rawTitle === "string"
          ? rawTitle.trim()
          : String(rawTitle ?? "").trim();

      // url can be string | string[] | object | null
      const url =
        typeof rawUrl === "string"
          ? rawUrl.trim()
          : Array.isArray(rawUrl)
          ? String(rawUrl.find((x) => typeof x === "string") ?? "").trim()
          : "";

      // Only keep citations that have at least a title or url
      if (!title && !url) return null;

      return { title, url };
    })
    .filter(Boolean);

  await supabase.from("research_cache").insert({
    tenant_id: tenantId,
    cache_key: cacheKey,
    provider: "perplexity",
    answer: (payload.answer ?? null) ? String(payload.answer) : null,
    citations,
  });
}

// -----------------------------
// Council Findings layer
// -----------------------------
function normalizeFindingList(v: any, limit = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function buildCouncilFindings(items: Array<{ agent: string; telemetry: any | null }>): string {
  const alerts: string[] = [];
  const recommendations: string[] = [];
  const assumptions: string[] = [];
  const questions: string[] = [];

  for (const it of items) {
    const t = it.telemetry;
    if (!t || typeof t !== "object") continue;

    const a = normalizeFindingList((t as any).alerts);
    const r = normalizeFindingList((t as any).recommendations);
    const s = normalizeFindingList((t as any).assumptions);
    const q = normalizeFindingList((t as any).questions);

    for (const x of a) alerts.push(`[${it.agent}] ${x}`);
    for (const x of r) recommendations.push(`[${it.agent}] ${x}`);
    for (const x of s) assumptions.push(`[${it.agent}] ${x}`);
    for (const x of q) questions.push(`[${it.agent}] ${x}`);
  }

  const lines: string[] = [];
  lines.push("[Council Findings]");

  if (alerts.length) {
    lines.push("Alerts:");
    for (const x of alerts.slice(0, 10)) lines.push(`- ${x}`);
  }

  if (recommendations.length) {
    lines.push("\nRecommendations:");
    for (const x of recommendations.slice(0, 10)) lines.push(`- ${x}`);
  }

  if (assumptions.length) {
    lines.push("\nAssumptions:");
    for (const x of assumptions.slice(0, 10)) lines.push(`- ${x}`);
  }

  if (questions.length) {
    lines.push("\nSuggested Questions (pick ONE):");
    for (const x of questions.slice(0, 5)) lines.push(`- ${x}`);
  }

  return lines.join("\n");
}
function buildSynthesisPrompt(lastUser: string): ChatMessage {
  const u = (lastUser ?? "").trim();

  return {
    role: "user",
    content:
      `SYNTHESIS TASK\n` +
      `You are the final chat agent. Use ALL context above (account memory, KB, research, routing, perspectives, council).\n` +
      `Write the best possible reply to the user's most recent message.\n\n` +
      `User's most recent message:\n` +
      `${u || "(unknown)"}\n\n` +
      `Rules:\n` +
      `- Be direct and helpful.\n` +
      `- If something is missing, ask ONE clarifying question (only if required).\n`,
  };
}

function safeAgentList(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((s) => String(s)).filter(Boolean);
}

const RUNNABLE = new Set(["icpFit", "salesStrategy", "stakeholderMap", "draftOutreach", "chat"]);

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

    // --- Load thread row (account linkage) ---
    const { data: threadRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, account_id, title")
      .eq("tenant_id", tenantId)
      .eq("id", threadId)
      .maybeSingle();

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    // --- Load messages ---
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

    // --- Account memory (optional) ---
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

    // --- QB decides (routing + research intent) ---
    const decision = await decideRouteWithQb({
      messages,
      decisionContext: {},
      entityData: {},
    });

    const routing = (decision as any)?.routing;
    const plannedAgents = safeAgentList(
      routing?.priority_order?.length ? routing.priority_order : routing?.agents_to_call
    );

    const agentsToRun = plannedAgents.filter((a) => RUNNABLE.has(a));
    const route: "chat" | "icpFit" = agentsToRun.includes("icpFit") ? "icpFit" : "chat";

    // --- Perplexity research (cached) ---
    let researchMsg: ChatMessage | null = null;
    let usedResearch = false;

    if ((decision as any)?.needsResearch && (((decision as any)?.researchQueries?.length ?? 0) > 0)) {
      const cacheKey = makeCacheKey({
        route,
        queries: (decision as any).researchQueries ?? [],
        lastUser,
      });

      const cached = await getCachedResearch(supabase, tenantId, cacheKey);

      if (cached?.answer) {
        researchMsg = {
          role: "assistant",
          content: formatResearchBlock({
            answer: cached.answer,
            citations: (cached.citations ?? []) as any[],
          }),
        };
        usedResearch = true;
      } else {
        // Use the protocol prompt rather than a weak "research these" prompt.
        const subject = lastUser || "the target hospital";

        const pplx = await callPerplexity({
          messages: buildPerplexityMessages({
            target: subject,
            extraQueries: (decision as any).researchQueries ?? [],
          }),
          maxTokens: 2200,
        });

        if (pplx.ok) {
          await putCachedResearch(supabase, tenantId, cacheKey, {
            answer: pplx.answer,
            citations: pplx.citations ?? [],
          });

          researchMsg = {
            role: "assistant",
            content: formatResearchBlock({
              answer: pplx.answer,
              citations: pplx.citations,
            }),
          };
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

    // --- Augmented base messages (context injection) ---
    const augmented: ChatMessage[] = [
      ...messages,
      ...(accountMsg ? [accountMsg] : []),
      ...(researchMsg ? [researchMsg] : []),
      ...(kbMsg ? [kbMsg] : []),
    ];

    // --- Run specialists -> perspectives + council findings ---
    const perspectives: string[] = [];
    const councilInputs: Array<{ agent: string; telemetry: any | null }> = [];

    // NOTE: Wire entityData later from accounts/KB/patterns.
    const entityData = {};

    for (const agentId of agentsToRun) {
      if (agentId === "chat") continue;

      if (agentId === "icpFit") {
        const r: any = await runIcpFit({ tenantId, messages: augmented, entityData });
        const text = String(r?.content_text ?? "").trim();
        const telemetry = r?.qb_json ?? null;

        perspectives.push(
          `[Agent Perspective: ICP Fit]\n` +
            (text || "(empty)") +
            (telemetry ? `\n\n[Telemetry]\n${JSON.stringify(telemetry, null, 2)}` : "")
        );

        councilInputs.push({ agent: "icpFit", telemetry });
        continue;
      }

      if (agentId === "salesStrategy") {
        const r: any = await runSalesStrategy({ tenantId, messages: augmented, entityData });
        const text = String(r?.content_text ?? "").trim();
        const telemetry = r?.qb_json ?? null;

        perspectives.push(
          `[Agent Perspective: Sales Strategy]\n` +
            (text || "(empty)") +
            (telemetry ? `\n\n[Telemetry]\n${JSON.stringify(telemetry, null, 2)}` : "")
        );

        councilInputs.push({ agent: "salesStrategy", telemetry });
        continue;
      }

      if (agentId === "stakeholderMap") {
        const r: any = await runStakeholderMapping({ tenantId, messages: augmented, entityData });
        const text = String(r?.content_text ?? "").trim();
        const telemetry = r?.qb_json ?? null;

        perspectives.push(
          `[Agent Perspective: Stakeholder Map]\n` +
            (text || "(empty)") +
            (telemetry ? `\n\n[Telemetry]\n${JSON.stringify(telemetry, null, 2)}` : "")
        );

        councilInputs.push({ agent: "stakeholderMap", telemetry });
        continue;
      }

      if (agentId === "draftOutreach") {
        const r: any = await runDraftOutreach({
          tenantId,
          messages: augmented,
          entityData,
          channel: "email",
        });

        const text = String(r?.content_text ?? "").trim();
        const telemetry = r?.qb_json ?? null;

        perspectives.push(
          `[Agent Perspective: Draft Outreach]\n` +
            (text || "(empty)") +
            (telemetry ? `\n\n[Telemetry]\n${JSON.stringify(telemetry, null, 2)}` : "")
        );

        councilInputs.push({ agent: "draftOutreach", telemetry });
        continue;
      }
    }

    const perspectiveMsg: ChatMessage | null =
      perspectives.length > 0
        ? {
            role: "assistant",
            content: `[Agent Perspectives]\n\n${perspectives.join("\n\n---\n\n")}`,
          }
        : null;

    const councilMsg: ChatMessage | null =
      councilInputs.length > 0
        ? {
            role: "assistant",
            content: buildCouncilFindings(councilInputs),
          }
        : null;

    const routingMsg: ChatMessage = {
      role: "assistant",
      content:
        `[Routing]\n` +
        `decision_mode: ${routing?.decision_mode}\n` +
        `agents_to_call: ${(routing?.agents_to_call ?? []).join(", ")}\n` +
        `priority_order: ${(routing?.priority_order ?? []).join(", ")}\n` +
        `confidence: ${(decision as any)?.confidence}\n` +
        `reason: ${(decision as any)?.reason}`,
    };

const finalMessages: ChatMessage[] = [
  ...augmented,
  routingMsg,
  ...(perspectiveMsg ? [perspectiveMsg] : []),
  ...(councilMsg ? [councilMsg] : []),
  buildSynthesisPrompt(lastUser), // ✅ ensures last message is USER
];

// --- Chat Agent synthesis (mainAgent.md) ---
const agent = loadMainAgent();

const llm = await callClaude({
  system: agent.systemPrompt,
  messages: finalMessages,
  maxTokens: 2000,
});


    if (!llm.ok) {
      return NextResponse.json({ ok: false, error: llm.error ?? "Claude failed" }, { status: 502 });
    }

    const assistantText = String(llm.text ?? "").trim();
    if (!assistantText) {
      return NextResponse.json({ ok: false, error: "Empty model response" }, { status: 500 });
    }

    // --- Save assistant message ---
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
      route,
      confidence: (decision as any).confidence,
      usedResearch,
      usedKb,
      routing: (decision as any).routing,
      executed_agents: agentsToRun,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
