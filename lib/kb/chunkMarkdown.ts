// lib/kb/chunkMarkdown.ts

/**
 * Chunking rules:
 * - Prefer splitting at ## / ### headings (soft)
 * - Hard ceiling: maxTokens (default 800)
 * - Soft floor: minTokens (default 300)
 * - When forced-splitting long sections, use overlapTokens (default 80)
 *
 * Token counting is approximate (good enough for v1).
 */

export type Chunk = {
  chunk_index: number;
  content: string;
  token_count: number;
};

function estimateTokens(text: string): number {
  // Rough but stable: ~0.75 tokens/word average in English prose.
  // We overestimate slightly to respect ceilings.
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return Math.ceil(words * 1.35);
}

function splitByHeadings(md: string): string[] {
  const input = String(md ?? "").trim();
  if (!input) return [];

  // Split at lines starting with ## or ### (keep headings with their section)
  // We do this by finding heading indices and slicing.
  const lines = input.split("\n");
  const headingIdx: number[] = [];

  for (let i = 0; i < lines.length; i++) {
 if (/^#{1,4}\s+/.test(lines[i])) headingIdx.push(i);

  }

  // If no headings, one section
  if (headingIdx.length === 0) return [input];

  const sections: string[] = [];
  for (let h = 0; h < headingIdx.length; h++) {
    const start = headingIdx[h];
    const end = h + 1 < headingIdx.length ? headingIdx[h + 1] : lines.length;
    const slice = lines.slice(start, end).join("\n").trim();
    if (slice) sections.push(slice);
  }

  // Include any preface before first heading as its own section
  if (headingIdx[0] > 0) {
    const preface = lines.slice(0, headingIdx[0]).join("\n").trim();
    if (preface) sections.unshift(preface);
  }

  return sections;
}

function forceSplitLongText(text: string, maxTokens: number, overlapTokens: number): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];

  // Split on paragraphs first
  const paras = t.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];

  let buf: string[] = [];
  let bufTokens = 0;

  const flush = () => {
    const chunk = buf.join("\n\n").trim();
    if (chunk) out.push(chunk);
    buf = [];
    bufTokens = 0;
  };

  for (const p of paras) {
    const pTokens = estimateTokens(p);

    // If a single paragraph is gigantic, split by sentences/lines
    if (pTokens > maxTokens) {
      // flush current buffer first
      flush();

      const parts = p.split(/(?<=[.!?])\s+(?=[A-Z0-9])/g).map((x) => x.trim()).filter(Boolean);
      let sBuf: string[] = [];
      let sTokens = 0;

      const sFlush = () => {
        const chunk = sBuf.join(" ").trim();
        if (chunk) out.push(chunk);
        sBuf = [];
        sTokens = 0;
      };

      for (const part of parts) {
        const partTokens = estimateTokens(part);
        if (sTokens + partTokens > maxTokens && sBuf.length) {
          sFlush();
        }
        sBuf.push(part);
        sTokens += partTokens;
      }
      sFlush();

      continue;
    }

    if (bufTokens + pTokens > maxTokens && buf.length) {
      // Add overlap from end of previous buffer, if requested
      if (overlapTokens > 0) {
        const prev = buf.join("\n\n");
        const prevWords = prev.split(/\s+/).filter(Boolean);
        const overlapWordsCount = Math.min(prevWords.length, Math.ceil(overlapTokens / 1.35));
        const overlap = prevWords.slice(Math.max(0, prevWords.length - overlapWordsCount)).join(" ");

        flush();

        if (overlap.trim()) {
          buf.push(overlap.trim());
          bufTokens = estimateTokens(buf.join("\n\n"));
        }
      } else {
        flush();
      }
    }

    buf.push(p);
    bufTokens += pTokens;
  }

  flush();
  return out;
}

export function chunkMarkdown(md: string, opts?: {
  maxTokens?: number;
  minTokens?: number;
  overlapTokens?: number;
}): Chunk[] {
  const maxTokens = opts?.maxTokens ?? 800;
  const minTokens = opts?.minTokens ?? 300;
  const overlapTokens = opts?.overlapTokens ?? 80;

  const sections = splitByHeadings(md);
  const chunks: string[] = [];

  for (const section of sections) {
    const tok = estimateTokens(section);
    if (tok <= maxTokens) {
      chunks.push(section.trim());
    } else {
      const forced = forceSplitLongText(section, maxTokens, overlapTokens);
      chunks.push(...forced);
    }
  }

  // Merge tiny chunks (soft floor)
  const merged: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    const cur = chunks[i].trim();
    const curTok = estimateTokens(cur);

    if (curTok >= minTokens || i === chunks.length - 1) {
      merged.push(cur);
      i++;
      continue;
    }

    // Merge with next chunk if possible
    const next = (chunks[i + 1] ?? "").trim();
    if (!next) {
      merged.push(cur);
      i++;
      continue;
    }

    const combo = `${cur}\n\n${next}`.trim();
    merged.push(combo);
    i += 2;
  }

  return merged
    .map((content, idx) => ({
      chunk_index: idx,
      content: content.trim(),
      token_count: estimateTokens(content),
    }))
    .filter((c) => c.content.length > 0);
}
