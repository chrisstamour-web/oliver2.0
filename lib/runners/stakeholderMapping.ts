// src/lib/runners/stakeholderMapping.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractQbJsonBlock } from "@/lib/agents/qb/extractQbJsonBlock";
import { lastUserText } from "@/lib/runners/_core/lastUserText";

export interface StakeholderMappingContext {
  product_type?: string;
  therapy_area?: string;
  institution_type?: string;
  sales_context?: string;
  company_maturity?: string;
  budget_size?: string;
  integration_requirements?: string[];
  clinical_evidence?: string;
}

export type StakeholderMappingTelemetry = {
  type: "stakeholder_mapping";
  recommended_stakeholders?: string[];
  primary_stakeholder?: string;
  expected_response_rate?: number;
  signal_value?: "very_high" | "high" | "medium" | "low" | string;
  advancement_potential?: "very_high" | "high" | "medium" | "low" | string;
  avoid_stakeholders?: string[];
  budget_approval_path?: string[];
  confidence?: "High" | "Medium" | "Low" | string;
};

export type RunStakeholderMappingArgs = {
  tenantId: string;
  messages: ChatMessage[];
  entityData?: any;
  context?: StakeholderMappingContext;
  accountContext?: string;
};

type KbDocRow = {
  id: string;
  title: string | null;
  content: string | null;
  document_type: "instructional" | "knowledge" | null;
  status: "draft" | "approved" | "deprecated" | null;
  metadata: any;
  updated_at: string | null;
};

// ---- prompt cache (per serverless instance) ----
let _stakeholderMappingSystemPrompt: string | null = null;
function getStakeholderMappingSystemPrompt() {
  if (_stakeholderMappingSystemPrompt) return _stakeholderMappingSystemPrompt;
  _stakeholderMappingSystemPrompt = loadPromptMarkdown("stakeholderMapping.md");
  return _stakeholderMappingSystemPrompt;
}

// Works whether supabaseAdmin is a function or a client object
function getAdminClient() {
  return typeof supabaseAdmin === "function" ? supabaseAdmin() : supabaseAdmin;
}

function escapeForIlike(q: string) {
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

/**
 * Cheap KB retrieval (no embeddings):
 * - title/content ilike
 * - approved only
 * - cap rows
 */
async function kbSearchDocuments(
  tenantId: string,
  query: string,
  limit = 6,
  opts?: { docType?: "knowledge" | "instructional" | "any"; sourceType?: "notion" | "any" }
) {
  const admin = getAdminClient();
  const q = escapeForIlike(query);
  const docType = opts?.docType ?? "any";
  const sourceType = opts?.sourceType ?? "notion";

  let builder = admin
    .from("kb_documents")
    .select("id,title,content,document_type,status,metadata,updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (sourceType !== "any") builder = builder.eq("source_type", sourceType);
  if (docType !== "any") builder = builder.eq("document_type", docType);

  const { data, error } = await builder;
  if (error) throw new Error(`KB search failed: ${error.message}`);

  return (data ?? []) as KbDocRow[];
}

function buildContextSummary(ctx?: StakeholderMappingContext): string {
  const context = ctx ?? {};
  const parts: string[] = [];

  if (context.product_type) parts.push(`Product Type: ${context.product_type}`);
  if (context.therapy_area) parts.push(`Therapy Area: ${context.therapy_area}`);
  if (context.institution_type) parts.push(`Institution: ${context.institution_type}`);
  if (context.sales_context) parts.push(`Sales Context: ${context.sales_context}`);
  if (context.company_maturity) parts.push(`Company Maturity: ${context.company_maturity}`);
  if (context.budget_size) parts.push(`Budget: ${context.budget_size}`);
  if (context.integration_requirements?.length)
    parts.push(`Integration: ${context.integration_requirements.join(", ")}`);
  if (context.clinical_evidence) parts.push(`Clinical Evidence: ${context.clinical_evidence}`);

  return parts.length ? parts.join("\n") : "No context provided";
}

/**
 * Keep KB calls cheap:
 * - one composite query string
 * - de-dupe tokens
 */
function buildKbQuery(ctx?: StakeholderMappingContext): string {
  const c = ctx ?? {};
  const tokens: string[] = [
    "stakeholder mapping roles decision makers",
    "hospital buying committee procurement IT security",
    "budget approval path CFO CEO",
  ];

  if (c.product_type) tokens.push(`${c.product_type} stakeholders`);
  if (c.therapy_area) tokens.push(`${c.therapy_area} stakeholders`);
  if (c.institution_type) tokens.push(`${c.institution_type} approval authority`);
  if (c.budget_size) tokens.push(`deal size ${c.budget_size} approvals`);
  if (c.company_maturity === "unknown_startup") tokens.push("startup credibility pilot evidence");
  if (c.integration_requirements?.length) tokens.push(`integration ${c.integration_requirements.join(" ")}`);

  const uniq = Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean)));
  return uniq.join(" | ").slice(0, 600);
}

function formatKbContext(rows: KbDocRow[]) {
  if (!rows?.length) return "(No relevant KB documents found.)";
  return rows
    .map((r) => `## ${r.title ?? "Untitled"}\n${(r.content ?? "").slice(0, 2500)}`)
    .join("\n\n");
}

export async function runStakeholderMapping(args: RunStakeholderMappingArgs) {
  const systemPrompt = getStakeholderMappingSystemPrompt();

  const userInput = (args.accountContext ?? lastUserText(args.messages)).trim();
  if (!userInput) throw new Error("stakeholderMapping: empty user input");

  // Use provided context, otherwise derive from entityData
  const ctx = args.context ?? extractStakeholderContext(args.entityData);

  const ctxSummary = buildContextSummary(ctx);
  const kbQuery = buildKbQuery(ctx);

  // For stakeholder mapping, "knowledge" docs are usually best.
  const kbDocs = await kbSearchDocuments(args.tenantId, kbQuery, 6, { docType: "knowledge" }).catch(() => []);

  const augmentedSystem = `${systemPrompt}

[Knowledge Base]
${formatKbContext(kbDocs)}

[User Context]
${ctxSummary}
`.trim();

  const user = `Given the user’s request, produce a stakeholder mapping.

If you output telemetry, append:

<!--QB_JSON
{"type":"stakeholder_mapping"}
-->
`.trim();

  const llm = await callClaude({
    system: augmentedSystem,
    messages: [
      { role: "user", content: user },
      { role: "user", content: userInput },
    ],
    json: false,
    maxTokens: 1800,
  });

  if (!llm?.ok) throw new Error(llm?.error ?? "Claude failed");

  const raw = String(llm.text ?? "").trim();
  if (!raw) throw new Error("stakeholderMapping returned empty response");

  const { cleanedText, qbJson } = extractQbJsonBlock<StakeholderMappingTelemetry>(raw);

  return {
    ok: true,
    type: "stakeholder_mapping" as const,
    title: "Stakeholder Mapping",
    content_text: cleanedText,
    qb_json: qbJson,
  };
}

/**
 * Helper: Context Extractor (for QB + runners)
 */
export function extractStakeholderContext(entityData: any): StakeholderMappingContext {
  const e = entityData ?? {};
  const context: StakeholderMappingContext = {};

  if (e.product_category) context.product_type = String(e.product_category);
  if (e.therapy_area || e.department) context.therapy_area = String(e.therapy_area || e.department);

  if (e.institution_type) {
    const v = String(e.institution_type);
    context.institution_type = v === "Academic Medical Center" ? "amc" : "community_hospital";
  }

  if (e.contact_stage) context.sales_context = String(e.contact_stage);
  else if (e.inbound_lead) context.sales_context = "inbound";
  else if (e.warm_intro) context.sales_context = "warm_lead";
  else context.sales_context = "cold_prospecting";

  if (e.company_maturity) context.company_maturity = String(e.company_maturity);

  if (e.estimated_deal_size != null) {
    const budget = Number(e.estimated_deal_size);
    if (!Number.isNaN(budget)) {
      if (budget < 50_000) context.budget_size = "<50K";
      else if (budget < 250_000) context.budget_size = "50-250K";
      else if (budget < 1_000_000) context.budget_size = "250K-1M";
      else context.budget_size = ">1M";
    }
  }

  if (Array.isArray(e.integration_requirements)) {
    context.integration_requirements = e.integration_requirements.map(String).filter(Boolean);
  }

  if (e.clinical_evidence_level) context.clinical_evidence = String(e.clinical_evidence_level);

  return context;
}
