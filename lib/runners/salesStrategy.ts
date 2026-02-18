// lib/runners/salesStrategy.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";
import { extractQbJsonBlock } from "@/lib/agents/qb/extractQbJsonBlock";
import { lastUserText } from "@/lib/runners/_core/lastUserText";

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

  const { cleanedText, qbJson } = extractQbJsonBlock<SalesStrategyTelemetry>(raw);

  return {
    ok: true,
    type: "sales_strategy" as const,
    title: "Sales Strategy",
    content_text: cleanedText,
    qb_json: qbJson,
  };
}
