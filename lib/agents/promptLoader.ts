// src/lib/agents/promptLoader.ts
import "server-only";
import fs from "fs";
import path from "path";

export type LoadedPrompt = { text: string; foundPath: string };

// Per-instance cache (fine for serverless/node)
const CACHE = new Map<string, LoadedPrompt>();

function resolvePromptPath(filename: string): string {
  const f = String(filename ?? "").replace(/^\/+/, ""); // avoid absolute-ish paths
  return path.join(process.cwd(), "src", "lib", "agents", "prompts", f);
}

export function loadPrompt(filename: string): LoadedPrompt {
  const key = String(filename ?? "");
  const cached = CACHE.get(key);
  if (cached) return cached;

  const p = resolvePromptPath(filename);

  if (!fs.existsSync(p)) {
    throw new Error(`Prompt not found: ${filename}\nTried:\n- ${p}`);
  }

  const loaded = { text: fs.readFileSync(p, "utf8"), foundPath: p };
  CACHE.set(key, loaded);
  return loaded;
}

export function loadPromptText(filename: string): string {
  return loadPrompt(filename).text;
}

/**
 * Backward-compatible alias.
 * Your runners currently import { loadPromptMarkdown }.
 * Keep this during refactor to avoid touching every runner at once.
 */
export function loadPromptMarkdown(filename: string): string {
  return loadPromptText(filename);
}
