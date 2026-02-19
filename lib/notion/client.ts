// lib/notion/client.ts
type NotionQueryResponse = {
  results: any[];
  has_more: boolean;
  next_cursor: string | null;
};

const NOTION_VERSION = "2022-06-28";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export async function notionQueryDatabase(databaseId: string, cursor?: string) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("NOTION_API_KEY")}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion query failed (${res.status}): ${text}`);
  }

  return (await res.json()) as NotionQueryResponse;
}

export async function notionGetPage(pageId: string) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${requireEnv("NOTION_API_KEY")}`,
      "Notion-Version": NOTION_VERSION,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion get page failed (${res.status}): ${text}`);
  }

  return await res.json();
}

export async function notionGetBlockChildren(blockId: string, cursor?: string) {
  const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
  if (cursor) url.searchParams.set("start_cursor", cursor);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${requireEnv("NOTION_API_KEY")}`,
      "Notion-Version": NOTION_VERSION,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion get blocks failed (${res.status}): ${text}`);
  }

  return (await res.json()) as NotionQueryResponse;
}

function richTextToPlain(rt: any[] | undefined): string {
  if (!rt?.length) return "";
  return rt.map((x) => x?.plain_text ?? "").join("");
}

function indentLines(s: string, spaces: number): string {
  const pad = " ".repeat(Math.max(0, spaces));
  return String(s ?? "")
    .split("\n")
    .map((line) => (line.trim().length ? pad + line : line))
    .join("\n");
}

function normalizeMd(md: string): string {
  return String(md ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchAllChildren(blockId: string): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const data = await notionGetBlockChildren(blockId, cursor);
    all.push(...(data.results ?? []));
    if (!data.has_more) break;
    cursor = data.next_cursor ?? undefined;
  }

  return all;
}

/**
 * Render a single block to markdown (v1).
 * Recurses into children when has_children=true.
 */
async function renderBlock(b: any, depth: number): Promise<string> {
  const t = b?.type;
  const val = t ? b[t] : null;

  // helper: render children if present
  const renderChildren = async () => {
    if (!b?.has_children) return "";
    const kids = await renderBlocks(b.id, depth + 1);
    return kids ? `\n${kids}\n` : "";
  };

  // common text for blocks with rich_text
  const rt = val?.rich_text;
  const text = richTextToPlain(rt).trim();

  // headings
  if (t === "heading_1") return `# ${text}\n`;
  if (t === "heading_2") return `## ${text}\n`;
  if (t === "heading_3") return `### ${text}\n`;

  // paragraph
  if (t === "paragraph") {
    const kids = await renderChildren();
    const base = text ? `${text}\n` : "";
    return (base + (kids ? kids : "")).trimEnd() + "\n";
  }

  // lists
  if (t === "bulleted_list_item") {
    const kids = await renderChildren();
    const base = `- ${text}\n`;
    return base + (kids ? indentLines(kids.trimEnd(), 2) + "\n" : "");
  }

  if (t === "numbered_list_item") {
    const kids = await renderChildren();
    const base = `1. ${text}\n`;
    return base + (kids ? indentLines(kids.trimEnd(), 3) + "\n" : "");
  }

  if (t === "to_do") {
    const checked = Boolean(val?.checked);
    const kids = await renderChildren();
    const base = `- [${checked ? "x" : " "}] ${text}\n`;
    return base + (kids ? indentLines(kids.trimEnd(), 2) + "\n" : "");
  }

  // callout / quote
  if (t === "callout") {
    const icon = val?.icon?.emoji ? `${val.icon.emoji} ` : "";
    const kids = await renderChildren();
    const base = `> ${icon}${text}\n`;
    return base + (kids ? `> \n${indentLines(kids.trimEnd(), 2)}\n` : "");
  }

  if (t === "quote") {
    const kids = await renderChildren();
    const base = `> ${text}\n`;
    return base + (kids ? `> \n${indentLines(kids.trimEnd(), 2)}\n` : "");
  }

  if (t === "divider") return `---\n`;

  // code
  if (t === "code") {
    const lang = String(val?.language ?? "").trim();
    const code = richTextToPlain(val?.rich_text);
    return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
  }

  // toggle (common!)
  if (t === "toggle") {
    const kids = await renderChildren();
    const header = text ? `- **${text}**\n` : `- **Toggle**\n`;
    return header + (kids ? indentLines(kids.trimEnd(), 2) + "\n" : "");
  }

  // bookmarks / links
  if (t === "bookmark") {
    const url = String(val?.url ?? "").trim();
    return url ? `- ${url}\n` : "";
  }

  // files/images (just preserve URL if present)
  if (t === "image" || t === "file" || t === "pdf" || t === "video" || t === "audio") {
    const file =
      val?.type === "external"
        ? val?.external?.url
        : val?.type === "file"
        ? val?.file?.url
        : null;

    const caption = richTextToPlain(val?.caption).trim();
    const line = file ? `- Asset: ${file}${caption ? ` (${caption})` : ""}\n` : "";
    const kids = await renderChildren();
    return line + (kids ? kids : "");
  }

  // child_page / child_database (at least keep a pointer)
  if (t === "child_page") {
    const title = String(val?.title ?? "").trim();
    const kids = await renderChildren();
    const base = title ? `\n## ${title}\n` : "";
    return base + (kids ? kids : "");
  }

  if (t === "child_database") {
    const title = String(val?.title ?? "").trim();
    return title ? `\n## ${title}\n` : "";
  }

  // synced_block (often used in templates)
  if (t === "synced_block") {
    // Notion synced blocks often have children; render children if present.
    const kids = await renderChildren();
    return kids ? kids : "";
  }

  // columns
  if (t === "column_list" || t === "column") {
    const kids = await renderChildren();
    return kids ? kids : "";
  }

  // table (newer Notion tables can appear as table/table_row blocks)
  if (t === "table") {
    const kids = await renderChildren();
    return kids ? kids : "";
  }
  if (t === "table_row") {
    // val.cells is array of rich_text arrays
    const cells = Array.isArray(val?.cells)
      ? val.cells.map((c: any) => richTextToPlain(c).trim())
      : [];
    if (!cells.length) return "";
    return `- ${cells.join(" | ")}\n`;
  }

  // fallback: if has children, at least render them
  if (b?.has_children) {
    const kids = await renderChildren();
    return kids ? kids : "";
  }

  // otherwise ignore unknown blocks
  return "";
}

async function renderBlocks(rootBlockId: string, depth: number): Promise<string> {
  const blocks = await fetchAllChildren(rootBlockId);
  const parts: string[] = [];

  for (const b of blocks) {
    const s = await renderBlock(b, depth);
    if (s && s.trim()) parts.push(s);
  }

  return normalizeMd(parts.join("\n")) + "\n";
}

// Public: Pulls page blocks and renders markdown-ish text for RAG.
export async function notionPageToMarkdown(pageId: string) {
  const md = await renderBlocks(pageId, 0);
  return normalizeMd(md) + "\n";
}
