// src/lib/kb/searchKb.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type KbHit = {
  id: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  updated_at: string | null;
  metadata: any;
  rank?: number | null;
};

function extractKbQuery(raw: string) {
  const text = (raw ?? "").toLowerCase();

  // remove code fences + punctuation-ish
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  // drop common filler words (small list; good enough)
  const stop = new Set([
    "the","a","an","and","or","but","to","of","for","in","on","with","is","are","was","were",
    "i","we","you","they","it","this","that","these","those","can","could","should","would",
    "please","help","make","tell","show","explain","what","why","how",
  ]);

  const tokens = cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));

  // keep it short and high-signal
  return tokens.slice(0, 10).join(" ");
}

export async function searchKb(args: {
  tenantId: string;
  query: string;
  limit?: number;
}): Promise<KbHit[]> {
  const admin = supabaseAdmin();
  const limit = args.limit ?? 6;

  const raw = (args.query ?? "").trim();
  const q = extractKbQuery(raw) || raw.slice(0, 120);
  if (!q) return [];

  const { data, error } = await admin.rpc("kb_search", {
    p_tenant_id: args.tenantId,
    p_query: q,
    p_limit: limit,
  });

  if (error) throw new Error(`KB search failed: ${error.message}`);
  return (data ?? []) as KbHit[];
}
