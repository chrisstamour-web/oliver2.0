// lib/runners/draftOutreach.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";
import { extractQbJsonBlock } from "@/lib/agents/qb/extractQbJsonBlock";
import { lastUserText } from "@/lib/runners/_core/lastUserText";

export type DraftOutreachTelemetry = {
  type: "draft_outreach";
  channel?: "email" | "linkedin" | "call_script" | string;
  confidence?: "High" | "Medium" | "Low" | string;
  personalization_fields?: string[];
};

export type RunDraftOutreachArgs = {
  tenantId: string;
  messages: ChatMessage[];
  entityData?: any;
  accountContext?: string;
  channel?: "email" | "linkedin" | "call_script" | string;
};

let _draftOutreachSystemPrompt: string | null = null;
function getDraftOutreachSystemPrompt() {
  if (_draftOutreachSystemPrompt) return _draftOutreachSystemPrompt;
  _draftOutreachSystemPrompt = loadPromptMarkdown("draftOutreach.md");
  return _draftOutreachSystemPrompt;
}

function normalizeDraftOutreachTelemetry(
  qbJson: any,
  channel: string
): DraftOutreachTelemetry | undefined {
  if (!qbJson || typeof qbJson !== "object") return undefined;
  if (qbJson.type !== "draft_outreach") return undefined;

  // If channel is present, accept; otherwise set it
  const out: DraftOutreachTelemetry = { ...(qbJson as any) };
  if (!out.channel) out.channel = channel as any;
  return out;
}

export async function runDraftOutreach(args: RunDraftOutreachArgs) {
  const systemPrompt = getDraftOutreachSystemPrompt();

  const userInput = (args.accountContext ?? lastUserText(args.messages)).trim();
  if (!userInput) throw new Error("draftOutreach: empty user input");

  const entityData = args.entityData ?? {};
  const channel = args.channel ?? "email";

  const prospect = entityData.name || entityData.hospital_name || "Unknown";
  const champion = entityData?.champion_contacts?.primary?.name || "Not identified";

  const user = `Draft outreach for this prospect.

Account/Prospect: ${prospect}
Champion: ${champion}
Channel: ${channel}

User request:
${userInput}

Follow the rules in the system prompt.
Avoid placeholders unless required; if you must use placeholders, label them clearly.

If you produce telemetry, append:

<!--QB_JSON
{"type":"draft_outreach","channel":"${channel}"}
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
  if (!raw) throw new Error("draftOutreach returned empty response");

  const { cleanedText, qbJson } = extractQbJsonBlock<any>(raw);
  const telemetry = normalizeDraftOutreachTelemetry(qbJson, channel);

  return {
    ok: true,
    type: "draft_outreach" as const,
    title: "Draft Outreach",
    content_text: cleanedText,
    qb_json: telemetry,
  };
}
