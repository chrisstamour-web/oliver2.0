// app/api/sync/notion/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notionQueryDatabase } from "@/lib/notion/client";
import { mapNotionKbPageToRow } from "@/lib/notion/mappers";
import { chunkMarkdown } from "@/lib/kb/chunkMarkdown";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

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

function getDocStatus(row: any): string {
  // mapper stores status in metadata.status
  const s = String(row?.metadata?.status ?? "").trim().toLowerCase();
  return s || "draft";
}

export async function GET() {
  try {
    const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const NOTION_DB_ID = requireEnv("NOTION_KB_DB_ID");

    // Feature flags so sync works even without embeddings/billing
    const ENABLE_CHUNKS = (process.env.ENABLE_KB_CHUNKS ?? "0") === "1";
    const ENABLE_EMBEDDINGS = (process.env.ENABLE_KB_EMBEDDINGS ?? "0") === "1";

    const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
    const EMBEDDING_VERSION = process.env.EMBEDDING_VERSION || "v1";
    const EXPECTED_DIM = Number(process.env.EMBEDDING_DIM ?? "1536");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    console.log("🔄 Starting Notion → kb_documents sync...");
    console.log(`⚙️ ENABLE_KB_CHUNKS=${ENABLE_CHUNKS} ENABLE_KB_EMBEDDINGS=${ENABLE_EMBEDDINGS}`);

    const pages = await fetchAllNotionPages(NOTION_DB_ID);
    console.log(`📄 Found ${pages.length} pages in Notion DB`);

    let docsUpserted = 0;
    let chunksWritten = 0;

    let skippedMapper = 0;
    let skippedNoSource = 0;
    let skippedNotApproved = 0;
    let skippedNoContent = 0;

    // Lazy import so this route runs even if OpenAI billing isn't enabled yet.
    let embedText: null | ((text: string) => Promise<number[]>) = null;
    if (ENABLE_CHUNKS && ENABLE_EMBEDDINGS) {
      const mod = await import("@/lib/embeddings/openai");
      embedText = mod.embedText;
    }

    for (const page of pages) {
      // 1) Map Notion page -> kb_documents row
      let row: any;
      try {
        row = await mapNotionKbPageToRow(page);
      } catch (e: any) {
        skippedMapper++;
        console.log("⚠️ Skipping page due to mapper error:", e?.message ?? e);
        continue;
      }

      if (!row?.source_id) {
        skippedNoSource++;
        continue;
      }

      // 2) Only sync approved KB into runtime tables
      const status = getDocStatus(row);
      if (status !== "approved") {
        skippedNotApproved++;
        continue;
      }

      if (!row?.content || !String(row.content).trim()) {
        skippedNoContent++;
        continue;
      }

      // 3) Upsert document and fetch id
      const { data: doc, error: upErr } = await supabase
        .from("kb_documents")
        .upsert(row, { onConflict: "tenant_id,source_type,source_id" })
        .select("id, tenant_id")
        .single();

      if (upErr) throw new Error(`kb_documents upsert failed: ${upErr.message}`);
      if (!doc?.id) throw new Error("kb_documents upsert returned no id");

      docsUpserted++;

      // If chunking is disabled, stop here
      if (!ENABLE_CHUNKS) {
        console.log(`✅ Synced (docs only): ${row.title}`);
        continue;
      }

      const documentId = String(doc.id);
      const tenantId = String(doc.tenant_id);

      // 4) Chunk document content
      const chunks = chunkMarkdown(String(row.content), {
        maxTokens: 800,
        minTokens: 300,
        overlapTokens: 80,
      });

      if (!chunks.length) {
        console.log(`⚠️ No chunks produced for: ${row.title}`);
        continue;
      }

      // 5) Build chunk rows
      const chunkRows: any[] = [];

      for (const c of chunks) {
        let embedding: number[] | null = null;

        if (ENABLE_EMBEDDINGS) {
          if (!embedText) throw new Error("ENABLE_KB_EMBEDDINGS=1 but embedText not loaded");
          embedding = await embedText(c.content);

          if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIM) {
            throw new Error(
              `Embedding dim mismatch for ${row.title}: got ${embedding?.length}, expected ${EXPECTED_DIM}. ` +
                `Check EMBEDDING_MODEL/EMBEDDING_DIM.`
            );
          }
        }

        const base = {
          document_id: documentId,
          tenant_id: tenantId,
          chunk_index: c.chunk_index,
          content: c.content,
          token_count: c.token_count,
          embedding_model: ENABLE_EMBEDDINGS ? EMBEDDING_MODEL : null,
          embedding_version: ENABLE_EMBEDDINGS ? EMBEDDING_VERSION : null,
          semantic_tags: row.metadata ?? {}, // fine for v1
        };

        // IMPORTANT: only include `embedding` field when embeddings are enabled
        chunkRows.push(ENABLE_EMBEDDINGS ? { ...base, embedding } : base);
      }

      // 6) Replace chunks for this document (delete then insert)
      const { error: delErr } = await supabase
        .from("kb_chunks")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("document_id", documentId);

      if (delErr) throw new Error(`kb_chunks delete failed: ${delErr.message}`);

      const { error: insErr } = await supabase.from("kb_chunks").insert(chunkRows);
      if (insErr) throw new Error(`kb_chunks insert failed: ${insErr.message}`);

      chunksWritten += chunkRows.length;

      console.log(
        `✅ Synced + chunked${ENABLE_EMBEDDINGS ? " + embedded" : ""}: ${row.title} (${chunkRows.length} chunks)`
      );
    }

    console.log("🎉 Sync complete");

    return NextResponse.json({
      ok: true,
      pages_seen: pages.length,
      docs_upserted: docsUpserted,
      chunks_written: chunksWritten,
      skipped: {
        mapper_error: skippedMapper,
        no_source_id: skippedNoSource,
        not_approved: skippedNotApproved,
        no_content: skippedNoContent,
      },
      flags: {
        ENABLE_KB_CHUNKS: ENABLE_CHUNKS,
        ENABLE_KB_EMBEDDINGS: ENABLE_EMBEDDINGS,
      },
      embedding: ENABLE_EMBEDDINGS
        ? { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: EXPECTED_DIM }
        : null,
    });
  } catch (error: any) {
    console.error("🔥 Sync failed:", error);
    return NextResponse.json(
      { ok: false, error: error.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
