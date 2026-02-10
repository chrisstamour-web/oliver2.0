// src/lib/kb/searchKb.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type KbHit = {
  id: string;
  title: string | null;
  content_md: string | null;
  updated_at: string | null;
  metadata: any;
};

export async function searchKb(args: {
  tenantId: string;
  query: string;
  limit?: number;
}): Promise<KbHit[]> {
  const admin = supabaseAdmin();
  const limit = args.limit ?? 6;

  const q = (args.query ?? "").trim();
  if (!q) return [];

  const { data, error } = await admin
    .from("kb_items")
    .select("id,title,content_md,metadata,updated_at")
    .eq("tenant_id", args.tenantId)
    // simple keyword search (upgrade to embeddings later)
    .or(`title.ilike.%${q}%,content_md.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`KB search failed: ${error.message}`);
  return (data ?? []) as KbHit[];
}
