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

/* ------------------ mapper ------------------ */

export async function mapNotionKbPageToRow(page: any) {
  const source_id = page?.id;
  if (!source_id) {
    throw new Error("Notion page missing id");
  }

  /* -------- Tenant ID (REQUIRED) -------- */
  const tenantRaw = plainText(getProp(page, "Tenant ID")?.rich_text);
  if (!tenantRaw || !isUuid(tenantRaw)) {
    throw new Error(`KB item ${source_id} missing or invalid Tenant ID`);
  }

  /* -------- Phase (default = all) -------- */
  const phaseRaw = selectName(getProp(page, "Phase"));
  const phase = normalizePhase(phaseRaw);

  /* -------- Type (REQUIRED) -------- */
  const kb_type = selectName(getProp(page, "Type"));
  if (!kb_type) {
    throw new Error(`KB item ${source_id} missing required Type`);
  }

  /* -------- Status (default = draft) -------- */
  const statusRaw = selectName(getProp(page, "Status"));
  const status =
    statusRaw === "approved" || statusRaw === "deprecated"
      ? statusRaw
      : "draft";

  /* -------- Core content -------- */
  const title = plainText(getProp(page, "Title")?.title) || "Untitled";

  const summary = plainText(getProp(page, "Summary")?.rich_text) || null;

  const content_md = await notionPageToMarkdown(source_id);
  if (!content_md) {
    throw new Error(`KB item ${source_id} has empty content`);
  }

  /* -------- Tags -------- */
  const tags = multiSelectNames(getProp(page, "Tags"));

  return {
    // IMPORTANT: do NOT include `id`
    tenant_id: tenantRaw,
    phase,
    kb_type,
    status,

    title,
    summary,
    content_md,
    tags,

    source: "notion",
    source_id,
    notion_last_edited_time: page?.last_edited_time ?? null,
  };
}
