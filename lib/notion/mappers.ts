// lib/notion/mappers.ts
import { notionPageToMarkdown } from "./client";

function propTitle(page: any, name: string): string | null {
  const p = page?.properties?.[name];
  const arr = p?.title ?? [];
  const txt = arr.map((x: any) => x?.plain_text ?? "").join("").trim();
  return txt || null;
}

function propRichText(page: any, name: string): string {
  const p = page?.properties?.[name];
  const arr = p?.rich_text ?? [];
  return arr.map((x: any) => x?.plain_text ?? "").join("").trim();
}

function propCheckbox(page: any, name: string): boolean {
  const p = page?.properties?.[name];
  return !!p?.checkbox;
}

function propMultiSelect(page: any, name: string): string[] {
  const p = page?.properties?.[name];
  const arr = p?.multi_select ?? [];
  return arr.map((x: any) => String(x?.name ?? "").trim()).filter(Boolean);
}

function propTextAsJson(page: any, name: string): any {
  const raw = propRichText(page, name);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // keep it safe; don't blow up sync
    return { _parse_error: true, raw };
  }
}

/**
 * NOTION DB: Agents
 * Required properties (recommended):
 * - Key (title)               e.g. "icp_fit"
 * - Title (rich_text)         human title
 * - Active (checkbox)         mark 1 version as active
 * - Input Schema (rich_text)  JSON
 * - Output Schema (rich_text) JSON
 * - Examples (rich_text)      JSON array
 * - Tags (multi_select)
 *
 * Body content of the page becomes system_prompt_md (markdown)
 */
export async function mapNotionAgentPageToRow(page: any) {
  const key = propTitle(page, "Key");
  if (!key) return null;

  const source_id = page.id;
  const notion_last_edited_time = page.last_edited_time ?? null;

  const system_prompt_md = await notionPageToMarkdown(page.id);

  return {
    tenant_id: null,
    key,
    version: notion_last_edited_time ?? new Date().toISOString(),
    title: propRichText(page, "Title") || key,
    system_prompt_md,
    input_schema_json: propTextAsJson(page, "Input Schema"),
    output_schema_json: propTextAsJson(page, "Output Schema"),
    examples_json: propTextAsJson(page, "Examples"),
    tags: propMultiSelect(page, "Tags"),
    is_active: propCheckbox(page, "Active"),
    source: "notion",
    source_id,
    notion_last_edited_time,
  };
}

/**
 * NOTION DB: KB
 * Required properties (recommended):
 * - Title (title)
 * - Summary (rich_text)
 * - Tags (multi_select)
 *
 * Page body becomes content_md
 */
export async function mapNotionKbPageToRow(page: any) {
  const title = propTitle(page, "Title") ?? "Untitled";
  const source_id = page.id;
  const notion_last_edited_time = page.last_edited_time ?? null;

  const content_md = await notionPageToMarkdown(page.id);

  return {
    tenant_id: null,
    title,
    summary: propRichText(page, "Summary") || null,
    content_md,
    tags: propMultiSelect(page, "Tags"),
    source: "notion",
    source_id,
    notion_last_edited_time,
  };
}
