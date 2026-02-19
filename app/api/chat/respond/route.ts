// app/api/chat/respond/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { loadMainAgent } from "@/lib/runners/mainAgent";
import { callClaude } from "@/lib/llm/claude";
import type { ChatMessage } from "@/lib/llm/types";
import { decideRouteWithQb } from "@/lib/agents/qb/qbRouter";

import { RUNNERS, getRunner } from "@/lib/runners/registry";

import { callPerplexity } from "@/lib/llm/perplexity";
import { searchKb } from "@/lib/kb/searchKb";
import { formatKbBlock } from "@/lib/kb/formatKb";

export const runtime = "nodejs";
export const maxDuration = 300;

// -----------------------------
// Timeouts + perf tuning
// -----------------------------
const RESEARCH_TIMEOUT_MS = 20_000; // keep under maxDuration
const KB_TIMEOUT_MS = 3_000;
const QB_TIMEOUT_MS = 6_000;
const AGENT_TIMEOUT_MS = 18_000;
const MAX_AGENT_CONCURRENCY = 3;

// Research tuning
const PPLX_MAX_TOKENS = 1800; // keep research compact; caching provides continuity
const PPLX_CACHE_TTL_DAYS = 7; // match cache query window
const MIN_KB_HITS_FOR_SKIP_RESEARCH = 4; // if KB is rich, we can often skip web research for hospitals

// -----------------------------
// Types
// -----------------------------
type Row = {
  role: string | null;
  content: any; // can be non-string in old rows
  created_at: string | null;
};

type DecisionMode = "rules" | "judgment" | "council" | "escalation";

// -----------------------------
// Small helpers
// -----------------------------
function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function normalizeMessages(rows: Row[]): ChatMessage[] {
  return (rows ?? []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: toText(m.content),
  }));
}

function lastUserText(messages: ChatMessage[]) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return toText((messages[i] as any)?.content);
  }
  return "";
}

function insertBeforeLastUser(base: ChatMessage[], insert: ChatMessage | null): ChatMessage[] {
  if (!insert) return base;
  const idx = [...base].map((m) => m.role).lastIndexOf("user");
  if (idx === -1) return [insert, ...base];
  return [...base.slice(0, idx), insert, ...base.slice(idx)];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const cur = idx++;
      if (cur >= tasks.length) return;
      try {
        const val = await tasks[cur]();
        results[cur] = { status: "fulfilled", value: val };
      } catch (err) {
        results[cur] = { status: "rejected", reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

// -----------------------------
// Thread auto-title helpers
// -----------------------------
function cleanTitle(s: string) {
  const t = (s ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
  return t.length > 80 ? t.slice(0, 80).trim() : t;
}

function isEmptyTitle(v: any) {
  const t = String(v ?? "").trim();
  return !t || t.toLowerCase() === "new chat";
}

async function inferThreadTitle(args: { lastUser: string; recentMessages: ChatMessage[] }) {
  const { lastUser, recentMessages } = args;

  const transcript = recentMessages
    .slice(-8)
    .map((m) => `${m.role.toUpperCase()}: ${toText(m.content).slice(0, 240)}`)
    .join("\n");

  const system = [
    `You extract a short, human-friendly thread title.`,
    `Return ONLY the organization/hospital name being discussed.`,
    `If no specific org/hospital is clearly stated, return EXACTLY: UNKNOWN`,
    `Rules:`,
    `- No punctuation other than hyphens and apostrophes`,
    `- Max 8 words`,
    `- No extra text`,
  ].join("\n");

  const user = [
    `Last user message: ${lastUser || "(none)"}`,
    ``,
    `Recent transcript:`,
    transcript || "(empty)",
    ``,
    `Output:`,
  ].join("\n");

  const r = await callClaude({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 50,
  });

  if (!r.ok) return "";

  const raw = cleanTitle(toText(r.text ?? ""));
  if (!raw) return "";
  if (raw.toUpperCase() === "UNKNOWN") return "";

  return raw;
}

// -----------------------------
// Robust entity detection (hospital/org)
// -----------------------------
function looksLikeHospital(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;

  // strong keywords
  if (/(hospital|health\s*system|medical\s*center|medical centre|cancer\s*center|cancer centre|clinic|infirmary)/i.test(t))
    return true;

  // common naming patterns
  if (/university of .* (health|hospital|medical)/i.test(t)) return true;
  if (/(?:\b[A-Z][a-z]+\b\s+){1,}(Hospital|Health|Medical Center|Medical Centre|Cancer Center|Cancer Centre)\b/.test(t))
    return true;

  return false;
}

function looksLikeNamedEntity(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;

  // 2+ capitalized words (rough proper noun heuristic)
  if (/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,})/.test(t)) return true;

  // org-ish suffixes
  if (/(Inc\.|LLC|Ltd|University|Health|Hospital|Clinic|System|Medical Center|Medical Centre|Cancer Center|Cancer Centre)/i.test(t))
    return true;

  return false;
}

function looksLikeIntelRequest(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;

  return /(prospect|account|research|intel|intelligence|background|overview|who is|leadership|team|staff|contacts|director|vp|cfo|ceo|head of|procurement|purchasing|rfp|rfi|vendor|partners|stack|platform|uses|implements|installed|linac|tps|eclipse|aria|raystation|mosaiq)/i.test(
    t
  );
}

/**
 * Try to pick a stable research target.
 * Priority:
 *  1) Thread title (after auto-title) if it’s not "New chat"
 *  2) First strong "X Health/Hospital/Medical Center" phrase in lastUser
 *  3) Fallback: first 120 chars of lastUser
 */
function pickResearchTarget(args: { threadTitle: string; lastUser: string }): string {
  const threadTitle = String(args.threadTitle ?? "").trim();
  const lastUser = String(args.lastUser ?? "").trim();

  if (threadTitle && threadTitle.toLowerCase() !== "new chat") return threadTitle;

  const m =
    lastUser.match(
      /((?:\b[A-Z][a-zA-Z&.'-]+\b\s+){0,6}\b(?:Health(?:\sSystem)?|Hospital|Medical Center|Medical Centre|Cancer Center|Cancer Centre)\b(?:\s(?:of|at)\s(?:\b[A-Z][a-zA-Z&.'-]+\b\s*){1,6})?)/ // best-effort
    ) ?? null;

  const candidate = (m?.[1] ?? "").trim();
  if (candidate && candidate.length >= 6 && candidate.length <= 120) return candidate;

  return lastUser.slice(0, 120);
}

// -----------------------------
// Perplexity prompt construction (company-agnostic)
// -----------------------------
function buildPerplexityMessages(args: {
  target: string;
  purpose?: string; // e.g. "prospect_research"
  kind?: "hospital" | "organization";
  extraQueries?: string[];
}): ChatMessage[] {
  const system = [
    `ROLE + OBJECTIVE (STRICT)`,
    `You are an organization intelligence researcher.`,
    `Collect FACTS ONLY — no scoring, analysis, or recommendations.`,
    `Every claim MUST include a URL citation and, when possible, a short quote.`,
    ``,
    `EVIDENCE STANDARDS`,
    `- CONFIRMED: verified by 2+ primary sources`,
    `- ESTIMATED: inferred from proxies; explain proxies + reasoning`,
    `- UNKNOWN: not found after searching; list sources checked`,
    ``,
    `SOURCE PRIORITY (use in order)`,
    `1) Official organization websites (incl. subdomains)`,
    `2) Regulatory / government sources (where relevant)`,
    `3) Press releases (org/vendor)`,
    `4) Job postings (org + reputable boards)`,
    `5) LinkedIn profiles (current role at org)`,
    `6) Conference talks / webinars / abstracts`,
    `7) Industry publications (reputable)`,
    `8) Local news`,
    ``,
    `EXCLUDED SOURCES`,
    `- Wikipedia / general wikis`,
    `- unverified forums`,
    `- sales intelligence platforms (ZoomInfo/Apollo/etc.)`,
    `- sources older than 3 years for time-sensitive claims (unless only evidence)`,
    ``,
    `OUTPUT RULES`,
    `- Follow the schema exactly (NO duplication).`,
    `- Prefer last 24 months for people/tech/initiatives; include dates.`,
    `- If UNKNOWN, write UNKNOWN + sources checked.`,
    `- Keep it concise: bullets over prose.`,
  ].join("\n");

  const schemaBase = `
ORGANIZATION INTELLIGENCE REPORT
Target: ${args.target}
Purpose: ${args.purpose ?? "prospect_research"}
Type: ${args.kind ?? "organization"}

## 1) IDENTITY + STRUCTURE
Legal name | Common name | Headquarters | Regions served + Evidence (URL + quote)
Ownership/parent org | Affiliates | Org type (public/private/nonprofit/gov) + Evidence

## 2) OFFERINGS + CUSTOMERS
Primary offerings/services/products (top 3–7) + Evidence
Primary customer segments | Core markets | Key use-cases + Evidence

## 3) TECHNOLOGY + OPERATIONS (ONLY what you can prove)
Key systems/tools/platforms mentioned publicly + Evidence
Operational signals (recent upgrades, migrations, modernization) + Evidence

## 4) KEY PEOPLE (LAST 24 MONTHS)
Exec sponsor candidates (names + titles + LinkedIn URLs) + Evidence
Functional leaders relevant to the purpose (names + titles + LinkedIn URLs) + Evidence

## 5) HIRING + INVESTMENT SIGNALS
Job postings (last 12mo): Title | date | quote | URL
Capital initiatives / partnerships / funding (last 24mo): item | date | quote | URL

## 6) TRIGGER EVENTS (LAST 6 MONTHS)
For each: Event | Date | Evidence (URL + quote)

## 7) COMPETITIVE / VENDOR LANDSCAPE (ONLY if evidenced)
Named vendors/partners | procurement/RFP mentions | contract timing (if found) + Evidence

## DATA GAPS
Critical data NOT found + sources checked
3–5 discovery questions to fill gaps

## SOURCES CONSULTED
Complete URL list
`.trim();

  const extra = (args.extraQueries ?? []).filter(Boolean).slice(0, 10);
  const extraBlock = extra.length
    ? `\n\nADDITIONAL SEARCH QUERIES (use to guide your search):\n- ${extra.join("\n- ")}`
    : "";

  return [
    { role: "system", content: system },
    { role: "user", content: schemaBase + extraBlock },
  ];
}

function formatResearchBlock(p: { answer?: string; citations?: { title?: unknown; url?: unknown }[] }) {
  const lines: string[] = [];
  lines.push("[External Research — Perplexity]");

  // Keep the research block small so it doesn't blow up synthesis tokens.
  // Full text still goes to research_cache.
  const a = String(p.answer ?? "").trim();
  if (a) {
    const maxChars = 2600;
    lines.push(a.length > maxChars ? a.slice(0, maxChars) + "\n…(truncated for context)" : a);
  }

  if (p.citations?.length) {
    lines.push("\nCitations:");
    for (const c of p.citations.slice(0, 10)) {
      const t = String(c?.title ?? "").trim();
      const rawUrl = (c as any)?.url;
      const url =
        typeof rawUrl === "string"
          ? rawUrl
          : Array.isArray(rawUrl)
          ? rawUrl.find((x) => typeof x === "string") ?? ""
          : "";
      lines.push(`- ${t || "Source"}: ${String(url).trim()}`);
    }
  }

  return lines.join("\n");
}

// -----------------------------
// Research cache
// -----------------------------
function makeCacheKey(input: { route: string; queries: string[]; target: string }) {
  const q = (input.queries ?? []).slice(0, 4).join("|");
  const t = (input.target ?? "").slice(0, 160);
  return `route=${input.route}::target=${t}::q=${q}`;
}

async function getCachedResearch(supabase: any, tenantId: string, cacheKey: string) {
  const since = new Date(Date.now() - PPLX_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

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

      const title = typeof rawTitle === "string" ? rawTitle.trim() : String(rawTitle ?? "").trim();

      const url =
        typeof rawUrl === "string"
          ? rawUrl.trim()
          : Array.isArray(rawUrl)
          ? String(rawUrl.find((x) => typeof x === "string") ?? "").trim()
          : "";

      if (!title && !url) return null;
      return { title, url };
    })
    .filter(Boolean);

  await supabase.from("research_cache").insert({
    tenant_id: tenantId,
    cache_key: cacheKey,
    provider: "perplexity",
    answer: payload.answer ? String(payload.answer) : null,
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
      `- Default to SHORT unless the user explicitly asks for detail.\n` +
      `- Max 8 bullets total.\n` +
      `- Use this format:\n` +
      `  1) Answer (1–3 sentences)\n` +
      `  2) Key points (3–6 bullets)\n` +
      `  3) Next step (1 bullet)\n` +
      `- If something is missing, ask ONE clarifying question (only if required).\n`,
  };
}

function safeAgentList(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((s) => String(s)).filter(Boolean);
}

// Back-compat: older QB outputs used "stakeholderMap"
function normalizeAgentId(id: string): string {
  if (id === "stakeholderMap") return "stakeholderMapping";
  return id;
}

// Single source of truth: registry + "chat"
const RUNNABLE = new Set<string>(["chat", ...Object.keys(RUNNERS)]);

// Any runner-specific default args belong here (no switch-case needed)
const RUNNER_DEFAULT_ARGS: Record<string, any> = {
  draftOutreach: { channel: "email" },
};

// -----------------------------
// Decision-mode enforcement
// -----------------------------
function normalizeDecisionMode(raw: any): DecisionMode {
  const s = String(raw ?? "").trim();
  if (s === "rules" || s === "judgment" || s === "council" || s === "escalation") return s;
  return "judgment";
}

function enforceSpecialistCountByMode(args: {
  mode: DecisionMode;
  planned: string[]; // already normalized + runnable; may include "chat"
}): { mode: DecisionMode; specialists: string[]; enforcement_note: string } {
  const mode = args.mode;
  const planned = (args.planned ?? []).map(String).filter(Boolean);

  // Only specialists (exclude chat)
  const specialists = planned.filter((a) => a !== "chat");

  const take = (n: number) => specialists.slice(0, Math.max(0, n));
  const clamp = (min: number, max: number) =>
    specialists.slice(0, Math.max(min, Math.min(max, specialists.length)));

  if (mode === "rules") {
    const out = take(1);
    const note =
      specialists.length > 1
        ? `rules: truncated specialists ${specialists.length} -> ${out.length}`
        : `rules: ok (${out.length})`;
    return { mode: "rules", specialists: out, enforcement_note: note };
  }

  if (mode === "judgment") {
    if (specialists.length < 2) {
      const downgraded = "rules";
      return {
        mode: downgraded,
        specialists: take(1),
        enforcement_note: `judgment: insufficient specialists (${specialists.length}); downgraded -> ${downgraded}`,
      };
    }
    const out = take(2);
    const note =
      specialists.length > 2
        ? `judgment: truncated specialists ${specialists.length} -> ${out.length}`
        : `judgment: ok (${out.length})`;
    return { mode: "judgment", specialists: out, enforcement_note: note };
  }

  if (mode === "council") {
    if (specialists.length < 2) {
      const downgraded = specialists.length === 1 ? "judgment" : "rules";
      return {
        mode: downgraded,
        specialists: take(specialists.length === 1 ? 1 : 0),
        enforcement_note: `council: insufficient specialists (${specialists.length}); downgraded -> ${downgraded}`,
      };
    }
    const out = clamp(2, 3); // 2–3
    const note =
      specialists.length > 3
        ? `council: truncated specialists ${specialists.length} -> ${out.length}`
        : `council: ok (${out.length})`;
    return { mode: "council", specialists: out, enforcement_note: note };
  }

  // escalation: allow 2–4 (but never force additions)
  if (specialists.length < 2) {
    const downgraded = specialists.length === 1 ? "council" : "judgment";
    return {
      mode: downgraded,
      specialists: take(specialists.length),
      enforcement_note: `escalation: insufficient specialists (${specialists.length}); downgraded -> ${downgraded}`,
    };
  }

  const out = specialists.slice(0, 4);
  const note =
    specialists.length > 4
      ? `escalation: truncated specialists ${specialists.length} -> ${out.length}`
      : `escalation: ok (${out.length})`;
  return { mode: "escalation", specialists: out, enforcement_note: note };
}

// -----------------------------
// Specialist runner (registry-based)
// -----------------------------
async function runOneAgent(args: {
  agentId: string;
  tenantId: string;
  messages: ChatMessage[];
  entityData: any;
}): Promise<{ agentId: string; title: string; content_text: string; telemetry: any | null }> {
  const { agentId, tenantId, messages, entityData } = args;

  const runner = RUNNABLE.has(agentId) && agentId !== "chat" ? (getRunner as any)(agentId) : null;

  if (!runner) {
    return { agentId, title: agentId, content_text: "", telemetry: null };
  }

  const defaults = RUNNER_DEFAULT_ARGS[agentId] ?? {};

  const r: any = await runner({
    tenantId,
    messages,
    entityData,
    ...defaults,
  });

  return {
    agentId,
    title: String(r?.title ?? agentId),
    content_text: toText(r?.content_text ?? "").trim(),
    telemetry: r?.qb_json ?? null,
  };
}

// -----------------------------
// Route handler
// -----------------------------
export async function POST(req: Request) {
  try {
    const { supabase, tenantId, user } = await getTenantIdOrThrow();

    const body = await req.json().catch(() => ({}));
    const threadId = body?.threadId;

    if (!threadId || typeof threadId !== "string") {
      return NextResponse.json({ ok: false, error: "threadId required" }, { status: 400 });
    }

    const { data: threadRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, account_id, title")
      .eq("tenant_id", tenantId)
      .eq("id", threadId)
      .maybeSingle();

    if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    if (!threadRow) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const { data: rows, error: mErr } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("tenant_id", tenantId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

    const messages: ChatMessage[] = normalizeMessages((rows ?? []) as Row[]);
    const lastUser = lastUserText(messages);

    // Account memory (optional)
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
        accountMsg = {
          role: "assistant",
          content:
            `[Account Memory]\n` +
            `Account: ${toText(acct.name)}\n` +
            `Last updated: ${toText(acct.updated_at ?? "unknown")}\n` +
            `Known facts (tenant-owned):\n${JSON.stringify(facts, null, 2)}\n\n` +
            `Rules: Treat as context. Do not claim facts not present here.`,
        };
      }
    }

    // -----------------------------
    // KB retrieval (never fatal + timed) — run early so we can decide if KB is thin
    // -----------------------------
    let kbMsg: ChatMessage | null = null;
    let usedKb = false;
    let kbHitCount = 0;

    if (lastUser?.trim()) {
      const kbRes = await withTimeout(
        searchKb({ tenantId, query: lastUser.slice(0, 800), limit: 6 }),
        KB_TIMEOUT_MS,
        "KB search"
      ).catch(() => null);

      kbHitCount = Array.isArray(kbRes) ? kbRes.length : 0;

      if (kbRes?.length) {
        const kbBlock = formatKbBlock(kbRes);
        if (kbBlock) {
          kbMsg = { role: "assistant", content: kbBlock };
          usedKb = true;
        }
      }
    }

    // Optional: Inject canonical product brief if Adaptiiv is mentioned
    const mentionsAdaptiiv = /adaptiiv/i.test(lastUser);
    let adaptiivKbMsg: ChatMessage | null = null;

    if (mentionsAdaptiiv) {
      const adaptiivRes = await withTimeout(
        searchKb({ tenantId, query: "Adaptiiv Canonical Product Brief Approved", limit: 4 }),
        KB_TIMEOUT_MS,
        "KB search (Adaptiiv canonical)"
      ).catch(() => null);

      if (adaptiivRes?.length) {
        const block = formatKbBlock(adaptiivRes);
        if (block) adaptiivKbMsg = { role: "assistant", content: block };
      }
    }

    // -----------------------------
    // QB routing
    // -----------------------------
    const decision = await withTimeout(
      decideRouteWithQb({ messages, decisionContext: {}, entityData: {} }),
      QB_TIMEOUT_MS,
      "QB router"
    ).catch((err) => {
      return {
        confidence: 0.2,
        reason: `QB failed: ${toText((err as any)?.message ?? err)}`,
        routing: {
          decision_mode: "judgment",
          agents_to_call: ["chat"],
          priority_order: ["chat"],
        },
        needsResearch: false,
        researchQueries: [],
      } as any;
    });

    const routing = (decision as any)?.routing ?? {};
    const rawMode = normalizeDecisionMode(routing?.decision_mode);

    const plannedAgentsRaw = safeAgentList(
      routing?.priority_order?.length ? routing.priority_order : routing?.agents_to_call
    );

    const plannedAgents = plannedAgentsRaw.map(normalizeAgentId).filter((a) => RUNNABLE.has(a));

    const enforced = enforceSpecialistCountByMode({ mode: rawMode, planned: plannedAgents });

    const agentsToRun = enforced.specialists.length ? enforced.specialists : ["chat"];

    const routeForCache = (agentsToRun.find((a) => a !== "chat") as string | undefined) ?? "chat";

    // -----------------------------
    // Perplexity research (cached + timed) — robust + hospital-guaranteed
    // -----------------------------
    let researchMsg: ChatMessage | null = null;
    let usedResearch = false;

    const isHospitalChat = looksLikeHospital(lastUser);
    const namedEntity = looksLikeNamedEntity(lastUser);
    const intelRequest = looksLikeIntelRequest(lastUser);

    const researchQueries = Array.isArray((decision as any)?.researchQueries)
      ? ((decision as any).researchQueries as any[]).map((q) => String(q ?? "").trim()).filter(Boolean)
      : [];

    const needsResearch = Boolean((decision as any)?.needsResearch);

    const specialistIdsPlanned = agentsToRun.filter((a) => a !== "chat");

    const researchSensitiveAgents = new Set(["icpFit", "stakeholderMapping", "salesStrategy", "draftOutreach"]);
    const routeSensitive = specialistIdsPlanned.some((a) => researchSensitiveAgents.has(a));

    const kbLooksThin = kbHitCount < MIN_KB_HITS_FOR_SKIP_RESEARCH;

    // Guarantee: whenever it's a hospital chat, we try to include fresh/cached external context.
    // Otherwise, run research if router asks OR KB is thin + it looks like intel.
    const canRunResearch =
      isHospitalChat ||
      (needsResearch && researchQueries.length >= 1) ||
      (kbLooksThin && (intelRequest || namedEntity)) ||
      (routeSensitive && kbLooksThin);

    // Stable subject (prevents re-research every turn)
    const subject = pickResearchTarget({ threadTitle: String(threadRow?.title ?? ""), lastUser });

    if (canRunResearch) {
      // Robust query pack:
      // - if QB provided queries, use them
      // - else use a default bundle tailored for hospitals vs orgs
      const effectiveQueries =
        researchQueries.length > 0
          ? researchQueries.slice(0, 10)
          : isHospitalChat
          ? [
              `${subject} official site`,
              `${subject} locations`,
              `${subject} leadership team`,
              `${subject} radiation oncology`,
              `${subject} medical physics`,
              `${subject} job postings medical physicist`,
              `${subject} press release`,
              `${subject} procurement RFP`,
            ]
          : [
              `${subject} official site`,
              `${subject} leadership team`,
              `${subject} recent press release`,
              `${subject} job postings`,
              `${subject} technology stack`,
              `${subject} partnerships`,
            ];

      const cacheKey = makeCacheKey({
        route: routeForCache,
        queries: effectiveQueries,
        target: subject,
      });

      const cached = await withTimeout(getCachedResearch(supabase, tenantId, cacheKey), 2_000, "Research cache read").catch(
        () => null
      );

      if (cached?.answer) {
        usedResearch = true;
        researchMsg = {
          role: "assistant",
          content: formatResearchBlock({
            answer: cached.answer,
            citations: (cached.citations ?? []) as any[],
          }),
        };
      } else {
        const pplx = await withTimeout(
          callPerplexity({
            messages: buildPerplexityMessages({
              target: subject,
              purpose: isHospitalChat ? "hospital_prospect_research" : "prospect_research",
              kind: isHospitalChat ? "hospital" : "organization",
              extraQueries: effectiveQueries,
            }),
            maxTokens: PPLX_MAX_TOKENS,
          }),
          RESEARCH_TIMEOUT_MS,
          "Perplexity research"
        ).catch((err) => ({
          ok: false,
          answer: "",
          citations: [],
          error: toText((err as any)?.message ?? err),
        }));

        if ((pplx as any)?.ok) {
          usedResearch = true;
          researchMsg = {
            role: "assistant",
            content: formatResearchBlock({
              answer: (pplx as any).answer,
              citations: (pplx as any).citations,
            }),
          };

          void putCachedResearch(supabase, tenantId, cacheKey, {
            answer: (pplx as any).answer,
            citations: (pplx as any).citations ?? [],
          }).catch(() => {});
        } else {
          // make failures visible in logs (so you can tell if PPLX isn't configured)
          console.log("PPLX_FAIL", {
            subject,
            error: (pplx as any)?.error ?? "unknown",
          });
        }
      }
    }

    // -----------------------------
    // Build augmented context
    // -----------------------------
    let augmented: ChatMessage[] = [...messages];

    // Inject canonical product brief first (if applicable), then general KB, then account memory, then research.
    augmented = insertBeforeLastUser(augmented, adaptiivKbMsg);
    augmented = insertBeforeLastUser(augmented, kbMsg);

    if (accountMsg) augmented = [...augmented, accountMsg];
    if (researchMsg) augmented = [...augmented, researchMsg];

    console.log("RESPOND_TRACE", {
      threadId,
      routeForCache,
      plannedAgents,
      enforced_mode: enforced.mode,
      enforced_specialists: enforced.specialists,
      enforcement_note: enforced.enforcement_note,
      agentsToRun,
      needsResearch,
      canRunResearch,
      subject,
      isHospitalChat,
      kbHitCount,
      kbLooksThin,
      intelRequest,
      namedEntity,
      routeSensitive,
      researchQueriesCount: researchQueries.length,
      usedResearch,
      usedKb,
      runnable: Array.from(RUNNABLE),
    });

    // -----------------------------
    // Run specialists
    // -----------------------------
    const entityData = {};
    const specialistIds = agentsToRun.filter((a) => a !== "chat");

    const specialistTasks = specialistIds.map((agentId) => async () => {
      return await withTimeout(
        runOneAgent({ agentId, tenantId, messages: augmented, entityData }),
        AGENT_TIMEOUT_MS,
        `Agent:${agentId}`
      );
    });

    const settled = await runWithConcurrency(specialistTasks, MAX_AGENT_CONCURRENCY);

    const perspectives: string[] = [];
    const councilInputs: Array<{ agent: string; telemetry: any | null }> = [];

    for (let i = 0; i < settled.length; i++) {
      const agentId = specialistIds[i];
      const s = settled[i];

      if (s.status === "fulfilled") {
        const r = s.value;

        perspectives.push(
          `[Agent Perspective: ${r.title || agentId}]\n` +
            (r.content_text || "(empty)") +
            (r.telemetry ? `\n\n[Telemetry]\n${JSON.stringify(r.telemetry, null, 2)}` : "")
        );

        councilInputs.push({ agent: r.agentId, telemetry: r.telemetry ?? null });
      } else {
        councilInputs.push({
          agent: agentId,
          telemetry: {
            alerts: [`Agent failed: ${toText((s.reason as any)?.message ?? s.reason)}`],
            recommendations: [],
            assumptions: [],
            questions: [],
          },
        });
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
      councilInputs.length > 0 ? { role: "assistant", content: buildCouncilFindings(councilInputs) } : null;

    // Effective routing (post-enforcement) is what we expose to synthesis + API
    const effectiveRouting = {
      decision_mode: enforced.mode,
      agents_to_call: enforced.specialists.length ? enforced.specialists : ["chat"],
      priority_order: enforced.specialists.length ? enforced.specialists : ["chat"],
      enforcement_note: enforced.enforcement_note,
    };

    const routingMsg: ChatMessage = {
      role: "assistant",
      content:
        `[INTERNAL_ROUTING_DO_NOT_RENDER]\n` +
        `decision_mode: ${toText(effectiveRouting.decision_mode)}\n` +
        `agents_to_call: ${(effectiveRouting.agents_to_call ?? []).map(toText).join(", ")}\n` +
        `priority_order: ${(effectiveRouting.priority_order ?? []).map(toText).join(", ")}\n` +
        `confidence: ${toText((decision as any)?.confidence)}\n` +
        `reason: ${toText((decision as any)?.reason)}\n` +
        `enforcement_note: ${toText(effectiveRouting.enforcement_note)}`,
    };

    const finalMessages: ChatMessage[] = [
      ...augmented,
      routingMsg,
      ...(perspectiveMsg ? [perspectiveMsg] : []),
      ...(councilMsg ? [councilMsg] : []),
      buildSynthesisPrompt(lastUser),
    ];

    // -----------------------------
    // Main synthesis
    // -----------------------------
    const agent = loadMainAgent();

    const llm = await callClaude({
      system: agent.systemPrompt,
      messages: finalMessages,
      maxTokens: 2000, // per your request
    });

    if (!llm.ok) {
      return NextResponse.json({ ok: false, error: llm.error ?? "Claude failed" }, { status: 502 });
    }

    const assistantText = toText(llm.text ?? "").trim();
    if (!assistantText) {
      return NextResponse.json({ ok: false, error: "Empty model response" }, { status: 500 });
    }

    const { error: insErr } = await supabase.from("chat_messages").insert({
      tenant_id: tenantId,
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
      user_id: user.id,
    });

    if (insErr) {
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    // -----------------------------
    // Auto-title thread — best effort, never fatal
    // -----------------------------
    try {
      if (isEmptyTitle(threadRow?.title)) {
        const title = await withTimeout(inferThreadTitle({ lastUser, recentMessages: messages }), 3_000, "Thread auto-title").catch(
          () => ""
        );

        const finalTitle = cleanTitle(title);

        if (finalTitle) {
          await supabase
            .from("chat_threads")
            .update({ title: finalTitle })
            .eq("tenant_id", tenantId)
            .eq("id", threadId);
        }
      }
    } catch {
      // swallow
    }

    return NextResponse.json({
      ok: true,
      route: routeForCache,
      confidence: (decision as any).confidence,
      usedResearch,
      usedKb,
      research_subject: subject,
      routing: effectiveRouting,
      qb_routing_raw: routing,
      executed_agents: agentsToRun,
      runnable_agents: Array.from(RUNNABLE),
      specialist_results: settled.map((s, i) => ({
        agent: specialistIds[i],
        ok: s.status === "fulfilled",
        error: s.status === "rejected" ? toText((s.reason as any)?.message ?? s.reason) : null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown server error" }, { status: 500 });
  }
}
