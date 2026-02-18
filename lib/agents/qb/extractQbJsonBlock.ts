// src/lib/agents/qb/extractQbJsonBlock.ts
import "server-only";

export function extractQbJsonBlock<T = any>(
  text: string
): { cleanedText: string; qbJson?: T } {
  const raw = String(text ?? "");
  const re = /<!--\s*QB_JSON\s*([\s\S]*?)-->/i;
  const m = raw.match(re);
  if (!m) return { cleanedText: raw.trim() };

  const inner = (m[1] ?? "").trim();
  let parsed: any = undefined;

  try {
    parsed = JSON.parse(inner);
  } catch {
    parsed = undefined;
  }

  const cleanedText = raw.replace(re, "").trim();
  return { cleanedText, qbJson: parsed as T };
}
