// lib/notion/mappers.ts
import { notionPageToMarkdown } from "./client";

/* ------------------ helpers ------------------ */

function getProp(page: any, name: string) {
  return page?.properties?.[name] ?? null;
}

function plainText(arr?: any[] | null) {
  return (arr ?? [])
    .map((x: any) => String(x?.plain_text ?? ""))
    .join("")
    .trim();
}

function selectName(p: any): string | null {
  return p?.select?.name ?? null;
}

function multiSelectNames(p: any): string[] {
  return (p?.multi_select ?? [])
    .map((x: any) => String(x?.name ?? "").trim())
    .filter(Boolean);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

/**
 * Phase normalization.
 * Canonical storage values:
 *  - "1"
 *  - "1_2"  (means Phase 1 and Phase 2)
 *  - "all"
 *
 * Accepts common Notion labels like:
 *  - "1 and 2"
 *  - "1&2"
 *  - "1+2"
 *  - "1_2"
 */
function normalizePhase(v: string | null): "1" | "1_2" | "all" {
  const s = (v ?? "").trim().toLowerCase();

  if (s === "1") return "1";

  if (
    s === "1_2" ||
    s === "1 and 2" ||
    s === "1&2" ||
    s === "1 + 2" ||
    s === "1+2"
  ) {
    return "1_2";
  }

  return "all";
}

/**
 * Normalize status from Notion select.
 * Canonical storage values:
 *  - "draft"
 *  - "approved"
 *  - "deprecated"
 */
function normalizeStatus(v: string | null): "draft" | "approved" | "deprecated" {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "approved") return "approved";
  if (s === "deprecated") return "deprecated";
  return "draft";
}

/* ------------------ RAG Mapper (kb_documents) ------------------ */

export type KbDocumentRow = {
  tenant_id: string;
  source_type: "notion";
  source_id: string;
  title: string;
  content: string;
  document_type: "instructional" | "knowledge";
  status: "draft" | "approved" | "deprecated";
  metadata: Record<string, any>;
};

/**
 * Maps a Notion KB page -> kb_documents row (Phase 1 ingestion)
 *
 * IMPORTANT: Return shape must match kb_documents columns:
 * tenant_id, source_type, source_id, title, content, document_type, status, metadata
 */
export async function mapNotionKbPageToRow(page: any): Promise<KbDocumentRow> {
  const source_id = page?.id;
  if (!source_id) throw new Error("Notion page missing id");

  /* -------- Tenant ID (REQUIRED) -------- */
  const tenantRaw = plainText(getProp(page, "Tenant ID")?.rich_text);
  if (!tenantRaw || !isUuid(tenantRaw)) {
    throw new Error(`KB page ${source_id} missing or invalid Tenant ID`);
  }

  /* -------- Phase -------- */
  const phaseRaw = selectName(getProp(page, "Phase"));
  const phase = normalizePhase(phaseRaw);

  /* -------- Type (REQUIRED) -------- */
  const kbType = selectName(getProp(page, "Type"));
  if (!kbType) throw new Error(`KB page ${source_id} missing required Type`);

  /* -------- Status -------- */
  const statusRaw = selectName(getProp(page, "Status"));
  const status = normalizeStatus(statusRaw);

  /* -------- Title / Summary / Content -------- */
  const title =
    plainText(getProp(page, "Title")?.title) ||
    plainText(getProp(page, "Name")?.title) ||
    "Untitled";

  const summary = plainText(getProp(page, "Summary")?.rich_text) || null;

  const content = await notionPageToMarkdown(source_id);
  if (!content) throw new Error(`KB page ${source_id} has empty content`);

  /* -------- Tags -------- */
  const tags = multiSelectNames(getProp(page, "Tags"));

  /* -------- Determine document_type -------- */
  // You can refine this later (e.g., based on a Notion property)
  const document_type: "instructional" | "knowledge" =
    kbType.toLowerCase().includes("instruction") ? "instructional" : "knowledge";

  /* -------- Metadata (Preserve Everything Useful) -------- */
  const metadata = {
    phase,
    kb_type: kbType,
    summary,
    tags,
    notion_last_edited_time: page?.last_edited_time ?? null,
    // Keeping status in metadata is optional, but harmless and can help debugging
    status,
  };

  return {
    tenant_id: tenantRaw,
    source_type: "notion",
    source_id,
    title,
    content, // ✅ matches kb_documents column name
    document_type,
    status,  // ✅ real column (approved/draft/deprecated)
    metadata,
  };
}
