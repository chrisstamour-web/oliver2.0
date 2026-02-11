// lib/runners/salesStrategy.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";

export type SalesStrategyTelemetry = {
  type: "sales_strategy";
  confidence?: "High" | "Medium" | "Low" | string;
  key_moves?: string[];
  risks?: string[];
  next_milestone?: string;
};

export type RunSalesStrategyArgs = {
  tenantId: string;
  messages: ChatMessage[];
  entityData?: any;
  accountContext?: string;
};

let _salesStrategySystemPrompt: string | null = null;
function getSalesStrategySystemPrompt() {
  if (_salesStrategySystemPrompt) return _salesStrategySystemPrompt;
  const text = loadPromptMarkdown("salesStrategy.md");
  _salesStrategySystemPrompt = text;
  return _salesStrategySystemPrompt;
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
function extractQbJsonBlock(text: string): { cleanedText: string; qbJson?: SalesStrategyTelemetry } {
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

export async function runSalesStrategy(args: RunSalesStrategyArgs) {
  const systemPrompt = getSalesStrategySystemPrompt();

  const userInput = (args.accountContext ?? lastUserText(args.messages)).trim();
  const entityData = args.entityData || {};

  const entitySummary = `
**Account/Prospect:** ${entityData.name || entityData.hospital_name || "Unknown"}
**Type:** ${entityData.type || entityData.hospital_type || "Unknown"}
**Champion:** ${entityData?.champion_contacts?.primary?.name || "Not identified"}
**Notes:** ${entityData.notes || ""}
`.trim();

  const user = `Provide sales strategy guidance for this prospect.

${entitySummary}

${userInput ? `\nUser query: ${userInput}` : ""}

Write a natural, helpful assistant reply. Keep it actionable.

If your prompt defines a required structure, follow it exactly.

If you produce telemetry, append:

<!--QB_JSON
{"type":"sales_strategy"}
-->
`;

  const llm = await callClaude({
    system: systemPrompt,
    messages: [{ role: "user", content: user }],
    json: false,
    maxTokens: 1600,
  });

  if (!llm?.ok) throw new Error(llm?.error ?? "Claude failed");

  const raw = String(llm.text ?? "").trim();
  if (!raw) throw new Error("salesStrategy returned empty response");

  const { cleanedText, qbJson } = extractQbJsonBlock(raw);

  return {
    ok: true,
    type: "sales_strategy" as const,
    title: "Sales Strategy",
    content_text: cleanedText,
    qb_json: qbJson,
  };
}
