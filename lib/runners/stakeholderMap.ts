// src/lib/runners/stakeholderMapping.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";
import { searchKb } from "@/lib/kb/searchKb";
import { formatKbBlock } from "@/lib/kb/formatKb";

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

let _systemPrompt: string | null = null;
function getSystemPrompt() {
  if (_systemPrompt) return _systemPrompt;
  _systemPrompt = loadPromptMarkdown("stakeholderMapping.md");
  return _systemPrompt;
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
function extractQbJsonBlock<T = any>(text: string): { cleanedText: string; qbJson?: T } {
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
 * - one composite query
 * - cap results inside searchKb()
 */
function buildKbQuery(ctx?: StakeholderMappingContext): string {
  const c = ctx ?? {};
  const tokens: string[] = [
    "stakeholder role profiles decision authority response patterns",
    "hospital medtech buying committee",
    "budget approval path CFO CEO procurement",
  ];

  if (c.product_type) tokens.push(`${c.product_type} stakeholders`);
  if (c.therapy_area) tokens.push(`${c.therapy_area} department stakeholders`);
  if (c.institution_type) tokens.push(`${c.institution_type} approval authority`);
  if (c.budget_size) tokens.push(`deal size ${c.budget_size} approvals`);
  if (c.company_maturity === "unknown_startup") tokens.push("startup credibility FDA pilot evidence");
  if (c.integration_requirements?.length) tokens.push(`integration ${c.integration_requirements.join(" ")}`);

  // de-dupe + keep it from getting absurdly long
  const uniq = Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean)));
  return uniq.join(" | ").slice(0, 600);
}

export async function runStakeholderMapping(args: RunStakeholderMappingArgs) {
  const systemPrompt = getSystemPrompt();

  const userInput = (args.accountContext ?? lastUserText(args.messages)).trim();
  if (!userInput) throw new Error("stakeholderMapping: empty user input");

  const ctxSummary = buildContextSummary(args.context);
  const kbQuery = buildKbQuery(args.context);

  const kbHits = await searchKb({
    tenantId: args.tenantId,
    query: kbQuery,
    limit: 6,
  }).catch(() => []);

  const kbBlock = formatKbBlock(kbHits);
  const augmentedSystem = `${systemPrompt}

${kbBlock ? kbBlock : "[Knowledge Base]\n(no relevant KB hits)"}

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
 * Helper: Context Extractor (for QB)
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
