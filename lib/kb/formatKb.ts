// src/lib/kb/formatKb.ts
import type { KbHit } from "./searchKB";

function truncate(s: string, max = 1600) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "\n…(truncated)";
}

export function formatKbBlock(hits: KbHit[]) {
  if (!hits?.length) return "";

  const chunks = hits.map((h) => {
    const title = (h.title ?? "Untitled").trim();
    const body = truncate(h.content_md ?? "", 1600);
    return `## ${title}\n${body}`;
  });

  // Keep the header explicit so the main agent treats it as grounding context
  return `[Knowledge Base]\n${chunks.join("\n\n")}`.trim();
}
