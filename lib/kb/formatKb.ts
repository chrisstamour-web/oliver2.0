// src/lib/kb/formatKb.ts
import type { KbHit } from "./searchKb";

function truncate(s: string, max = 900) {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "\n…(truncated)";
}

function safeStr(v: unknown) {
  if (v == null) return "";
  return String(v);
}

function prettyIso(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return safeStr(iso);
  }
}

/**
 * Goal:
 * - Give the model high-signal, compact context.
 * - Include "why this matters" metadata (type/phase/tags/freshness).
 * - Prevent echoing large KB chunks in the user-facing answer.
 */
export function formatKbBlock(hits: KbHit[]) {
  if (!hits?.length) return "";

  // Hard caps to control prompt bloat
  const MAX_HITS = 5;
  const MAX_TOTAL_CHARS = 4200;

  const picked = hits.slice(0, MAX_HITS);

  const parts: string[] = [];
  parts.push(
    [
      "[KNOWLEDGE_BASE_CONTEXT — INTERNAL, DO NOT RENDER VERBATIM]",
      "Use this as grounding context. Summarize/paraphrase only.",
      "If KB conflicts with user-provided facts in this thread, ask ONE clarifying question.",
    ].join("\n")
  );

  let used = parts.join("\n").length;

  for (const h of picked) {
    const title = (h.title ?? "Untitled").trim();

    // Prefer summary if you have it; fall back to content
    const meta = (h as any).metadata ?? {};
    const kbType = safeStr(meta?.kb_type ?? meta?.type ?? "");
    const phase = safeStr(meta?.phase ?? "");
    const status = safeStr(meta?.status ?? "");
    const tags = Array.isArray(meta?.tags) ? meta.tags.filter(Boolean).slice(0, 8).join(", ") : "";

    const updated = prettyIso(h.updated_at);
    const rank = (h as any).rank != null ? Number((h as any).rank).toFixed(3) : "";

    const bodyRaw =
      (h as any).summary && typeof (h as any).summary === "string"
        ? (h as any).summary
        : (h as any).content ?? "";

    // Keep each hit small and consistent
    const body = truncate(String(bodyRaw), 900);

    const headerBits = [
      `## ${title}`,
      updated ? `- updated: ${updated}` : "",
      rank ? `- rank: ${rank}` : "",
      kbType ? `- type: ${kbType}` : "",
      phase ? `- phase: ${phase}` : "",
      status ? `- status: ${status}` : "",
      tags ? `- tags: ${tags}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const block = `${headerBits}\n\n${body}`.trim();
    if (!block) continue;

    // Enforce global cap
    if (used + block.length + 2 > MAX_TOTAL_CHARS) break;

    parts.push(block);
    used += block.length + 2;
  }

  return parts.join("\n\n").trim();
}
