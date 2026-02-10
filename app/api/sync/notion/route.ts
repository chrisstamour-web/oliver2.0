// app/api/sync/notion/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notionQueryDatabase } from "@/lib/notion/client";
import { mapNotionKbPageToRow } from "@/lib/notion/mappers";

export const runtime = "nodejs";

/**
 * Manual Notion → Supabase KB sync endpoint
 * URL (local): http://localhost:3000/api/sync/notion
 *
 * Requires env vars:
 *  - NOTION_API_KEY
 *  - NOTION_KB_DB_ID
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 */

async function fetchAllNotionPages(databaseId: string) {
  let all: any[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const data = await notionQueryDatabase(databaseId, cursor);
    all = all.concat(data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor ?? undefined;
  }

  return all;
}

function missingEnv(...keys: string[]) {
  const missing = keys.filter((k) => !process.env[k]);
  return missing.length ? missing : null;
}

export async function GET(_req: Request) {
  const missing = missingEnv(
    "NOTION_API_KEY",
    "NOTION_KB_DB_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  );

  if (missing) {
    return NextResponse.json(
      { ok: false, error: "Missing required env vars", missing },
      { status: 500 }
    );
  }

  const kbDb = process.env.NOTION_KB_DB_ID!;
  const admin = supabaseAdmin();

  let kbRows: any[] = [];
  try {
    const kbPages = await fetchAllNotionPages(kbDb);
    for (const p of kbPages) {
      const row = await mapNotionKbPageToRow(p);

      // ✅ Guard: only upsert rows that have a conflict key
      if (row?.source_id) kbRows.push(row);
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, phase: "notion_kb_fetch_or_map", error: String(e?.message ?? e) },
      { status: 500 }
    );
  }

  if (kbRows.length) {
    const { error } = await admin
      .from("kb_items")
      .upsert(kbRows, { onConflict: "source_id" });

    if (error) {
      return NextResponse.json(
        { ok: false, phase: "supabase_kb_upsert", error },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, kb_synced: kbRows.length });
}
