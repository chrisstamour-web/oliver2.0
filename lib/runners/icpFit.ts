// lib/runners/icpFit.ts
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";

export type IcpFitTelemetry = {
  type: "icp_fit";
  score?: number;
  tier?: 1 | 2 | 3;
  tier_label?: string;
  confidence?: "High" | "Medium" | "Low" | string;
  critical_gaps?: string[];
  disqualified?: boolean;
  disqualifier_reason?: string | null;
};

export type RunIcpFitArgs = {
  tenantId: string;
  messages: ChatMessage[];
  entityData?: any;
  companyContext?: string;
};

type KbRow = {
  id: string;
  title: string | null;
  content_md: string | null;
  metadata: any;
  updated_at: string | null;
};

// ---- prompt cache (per serverless instance) ----
let _icpFitSystemPrompt: string | null = null;
function getIcpFitSystemPrompt() {
  if (_icpFitSystemPrompt) return _icpFitSystemPrompt;

  const text = loadPromptMarkdown("icpFit.md"); // loader returns a string
  _icpFitSystemPrompt = text;

  return _icpFitSystemPrompt;
}

// Works whether supabaseAdmin is a function or a client object
function getAdminClient() {
  return typeof supabaseAdmin === "function" ? supabaseAdmin() : supabaseAdmin;
}

function escapeForIlike(q: string) {
  // Safer for PostgREST filter strings
  return String(q ?? "")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll(",", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .replaceAll('"', " ")
    .replaceAll("'", " ")
    .trim();
}

async function kbSearch(tenantId: string, query: string, limit = 8) {
  const admin = getAdminClient();
  const q = escapeForIlike(query);

  const { data, error } = await admin
    .from("kb_items")
    .select("id,title,content_md,metadata,updated_at")
    .eq("tenant_id", tenantId)
    .or(`title.ilike.%${q}%,content_md.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`KB search failed: ${error.message}`);
  return (data ?? []) as KbRow[];
}

function lastUserText(messages: ChatMessage[]) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

/**
 * Optional telemetry:
 * <!--QB_JSON {...} -->
 */
function extractQbJsonBlock(text: string): { cleanedText: string; qbJson?: IcpFitTelemetry } {
  const raw = String(text ?? "");
  const re = /<!--\s*QB_JSON\s*([\s\S]*?)-->/i;
  const m = raw.match(re);
  if (!m) return { cleanedText: raw.trim() };

  const inner = (m[1] ?? "").trim();

  let parsed: any = undefined;
  try {
    parsed = JSON.parse(inner);
  } catch {
    parsed = undefined;
  }

  const cleanedText = raw.replace(re, "").trim();
  return { cleanedText, qbJson: parsed };
}

export async function runIcpFit(args: RunIcpFitArgs) {
  const systemPrompt = getIcpFitSystemPrompt();

  const userInput = (args.companyContext ?? lastUserText(args.messages)).trim();
  const entityData = args.entityData || {};

  // Pull KB context for ICP fit
  const [icpFramework, disqualifiers, examples] = await Promise.all([
    kbSearch(args.tenantId, "ICP framework"),
    kbSearch(args.tenantId, "disqualifier"),
    kbSearch(args.tenantId, "example"),
  ]);

  const kbBundle = [
    ...icpFramework.map((x) => `## ${x.title ?? "Untitled"}\n${x.content_md ?? ""}`),
    ...disqualifiers.map((x) => `## ${x.title ?? "Untitled"}\n${x.content_md ?? ""}`),
    ...examples.map((x) => `## ${x.title ?? "Untitled"}\n${x.content_md ?? ""}`),
  ].join("\n\n");

  const system = `${systemPrompt}

Below is the Knowledge Base context:

${kbBundle || "(No relevant KB items found.)"}
`;

  const entitySummary = `
**Account/Prospect:** ${entityData.name || entityData.hospital_name || "Unknown"}
**Type:** ${entityData.type || entityData.hospital_type || "Unknown"}
**Volume:** ${entityData.volume_estimate || "Unknown"}
**TPS:** ${entityData?.tps_equipment?.tps || "Unknown"}
**Champion:** ${entityData?.champion_contacts?.primary?.name || "Not identified"}
`.trim();

  const user = `Assess ICP fit for this prospect.

${entitySummary}

${userInput ? `\nUser query: ${userInput}` : ""}

Write a natural, helpful assistant reply.

Required sections (in this order):
1) VERDICT: Tier 1/2/3 or Not ICP (bold the verdict)
2) SCORE: X/100 points
3) WHY (3–6 bullets max, concrete)
4) DATA GAPS (0–4 bullets, labeled by impact: CRITICAL/HIGH/MEDIUM/LOW)
5) TL;DR (one sentence)
6) One next question to move qualification forward

Then append:

<!--QB_JSON
{"type":"icp_fit","score":0-100,"tier":1|2|3,"tier_label":"Strategic Target|Qualified Prospect|Lower Priority|Not ICP","confidence":"High|Medium|Low","critical_gaps":[],"disqualified":false,"disqualifier_reason":null}
-->

Rules:
- Keep it concise (~150–250 words).
- Do NOT use code fences around QB_JSON.
- If TPS is unknown, flag as CRITICAL gap (and penalize if your framework says so).
`;

  const llm = await callClaude({
    system,
    messages: [{ role: "user", content: user }],
    json: false,
    maxTokens: 2000,
  });

  if (!llm?.ok) throw new Error(llm?.error ?? "Claude failed");

  const raw = String(llm.text ?? "").trim();
  if (!raw) throw new Error("icpFit returned empty response");

  const { cleanedText, qbJson } = extractQbJsonBlock(raw);

  return {
    ok: true,
    type: "icp_fit" as const,
    title: "ICP Fit",
    content_text: cleanedText,
    qb_json: qbJson,
  };
}
