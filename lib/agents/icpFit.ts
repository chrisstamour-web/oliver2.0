// src/lib/agents/icpFit.ts
import fs from "fs";
import path from "path";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";

/**
 * Local Agent type to avoid circular imports:
 * registry.ts imports ICP_FIT_AGENT from here.
 */
export type Agent = {
  id: string;
  name: string;
  version: string;
  systemPrompt: string;
};

/* ---------------------------------------------
 * 1) Agent definition (for registry.ts)
 * --------------------------------------------- */

function loadMarkdown(filename: string) {
  // supports both repos with /src and without /src
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", filename),
    path.join(process.cwd(), "lib", "agents", filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }

  throw new Error(`${filename} not found. Tried:\n- ${candidates.join("\n- ")}`);
}

export function loadIcpFitAgent(): Agent {
  const instructions = loadMarkdown("icpFit.md");
  return {
    id: "icp-fit",
    name: "ICP Fit",
    version: "v1.0",
    systemPrompt: instructions,
  };
}

export const ICP_FIT_AGENT = loadIcpFitAgent();

/* ---------------------------------------------
 * 2) Runner (KB + Claude)
 * --------------------------------------------- */

export type IcpFitResult = {
  score: number;
  tier: "Strong" | "Medium" | "Weak" | "Not ICP";
  evidence: { criterion: string; notes: string[] }[];
  gaps: string[];
  next_actions: string[];
};

export type RunIcpFitArgs = {
  tenantId: string;
  messages: ChatMessage[];
  companyContext?: string;
};

type KbRow = {
  id: string;
  title: string | null;
  content_md: string | null;
  metadata: any;
  updated_at: string | null;
};

async function kbSearch(tenantId: string, query: string, limit = 8) {
  const admin = supabaseAdmin(); // ✅ CALL THE FACTORY

  const { data, error } = await admin
    .from("kb_items")
    .select("id,title,content_md,metadata,updated_at")
    .eq("tenant_id", tenantId)
    .or(`title.ilike.%${query}%,content_md.ilike.%${query}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`KB search failed: ${error.message}`);
  return (data ?? []) as KbRow[];
}

function lastUserText(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  }
  return "";
}

/**
 * Claude sometimes returns JSON wrapped in prose/code fences.
 * Best-effort extraction of the outermost {...}.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export async function runIcpFit(args: RunIcpFitArgs) {
  const userInput = (args.companyContext ?? lastUserText(args.messages)).trim();

  const [icpDef, disqualifiers, examples] = await Promise.all([
    kbSearch(args.tenantId, "ICP"),
    kbSearch(args.tenantId, "disqualifier"),
    kbSearch(args.tenantId, "example"),
  ]);

  const kbBundle = [
    ...icpDef.map((x) => `## ${x.title ?? "Untitled"}\n${x.content_md ?? ""}`),
    ...disqualifiers.map(
      (x) => `## ${x.title ?? "Untitled"}\n${x.content_md ?? ""}`
    ),
    ...examples.map((x) => `## ${x.title ?? "Untitled"}\n${x.content_md ?? ""}`),
  ].join("\n\n");

  const system = `${ICP_FIT_AGENT.systemPrompt}

Below is the Knowledge Base context:

${kbBundle || "(No relevant KB items found.)"}
`;

  const user = `Company / target context:
${userInput}

Return ONLY valid JSON matching:

{
  "score": number,
  "tier": "Strong" | "Medium" | "Weak" | "Not ICP",
  "evidence": [{ "criterion": string, "notes": string[] }],
  "gaps": string[],
  "next_actions": string[]
}
`;

  const llm = await callClaude({
    system,
    messages: [{ role: "user", content: user }],
  });

  // ✅ matches your /api/chat/respond usage
  if (!llm?.ok) {
    throw new Error(llm?.error ?? "Claude failed");
  }

  const raw = String(llm.text ?? "").trim();
  if (!raw) throw new Error("icpFit returned empty response");

  const jsonStr = extractFirstJsonObject(raw) ?? raw;

  let parsed: IcpFitResult;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`icpFit returned invalid JSON. Raw output:\n${raw}`);
  }

  return {
    ok: true,
    type: "icp_fit" as const,
    title: "ICP Fit",
    content_json: parsed,
  };
}
