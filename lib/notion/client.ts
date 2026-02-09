// lib/notion/client.ts
type NotionQueryResponse = {
  results: any[];
  has_more: boolean;
  next_cursor: string | null;
};

const NOTION_VERSION = "2022-06-28";

export async function notionQueryDatabase(databaseId: string, cursor?: string) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
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
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion get page failed (${res.status}): ${text}`);
  }

  return await res.json();
}

// Pulls block children and flattens to plain text-ish markdown.
// Minimal implementation: good enough to start, upgrade later.
export async function notionGetBlockChildren(blockId: string, cursor?: string) {
  const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
  if (cursor) url.searchParams.set("start_cursor", cursor);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
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

// Very small markdown-ish renderer for common blocks.
// You can expand this later.
export async function notionPageToMarkdown(pageId: string) {
  let md = "";
  let cursor: string | undefined = undefined;

  while (true) {
    const data = await notionGetBlockChildren(pageId, cursor);
    for (const b of data.results) {
      const t = b.type;
      const val = b[t];

      if (t === "heading_1") md += `# ${richTextToPlain(val?.rich_text)}\n\n`;
      else if (t === "heading_2") md += `## ${richTextToPlain(val?.rich_text)}\n\n`;
      else if (t === "heading_3") md += `### ${richTextToPlain(val?.rich_text)}\n\n`;
      else if (t === "paragraph") md += `${richTextToPlain(val?.rich_text)}\n\n`;
      else if (t === "bulleted_list_item") md += `- ${richTextToPlain(val?.rich_text)}\n`;
      else if (t === "numbered_list_item") md += `1. ${richTextToPlain(val?.rich_text)}\n`;
      else if (t === "code") md += `\n\`\`\`\n${richTextToPlain(val?.rich_text)}\n\`\`\`\n\n`;
      // ignore other block types for now
    }

    if (!data.has_more) break;
    cursor = data.next_cursor ?? undefined;
  }

  return md.trim() + "\n";
}
