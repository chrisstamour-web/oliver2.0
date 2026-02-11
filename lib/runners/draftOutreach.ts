// lib/runners/draftOutreach.ts
import "server-only";

import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { loadPromptMarkdown } from "@/lib/agents/promptLoader";

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
function extractQbJsonBlock(text: string): { cleanedText: string; qbJson?: DraftOutreachTelemetry } {
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

  // validate shape lightly
  if (!parsed || typeof parsed !== "object" || parsed.type !== "draft_outreach") {
    return { cleanedText };
  }

  return { cleanedText, qbJson: parsed as DraftOutreachTelemetry };
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

  const { cleanedText, qbJson } = extractQbJsonBlock(raw);

  return {
    ok: true,
    type: "draft_outreach" as const,
    title: "Draft Outreach",
    content_text: cleanedText,
    qb_json: qbJson,
  };
}
