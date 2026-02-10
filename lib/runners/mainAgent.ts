// src/lib/agents/prompts/mainAgent.ts
import "server-only";

import fs from "fs";
import path from "path";

function loadAgentMarkdown(filename: string) {
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", filename),
    path.join(process.cwd(), "src", "lib", "agents", "prompts", filename),
    path.join(process.cwd(), "lib", "agents", filename),
    path.join(process.cwd(), "lib", "agents", "prompts", filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }

  throw new Error(`${filename} not found. Tried:\n- ${candidates.join("\n- ")}`);
}

let _main: { id: string; name: string; version: string; systemPrompt: string } | null = null;

export function loadMainAgent() {
  if (_main) return _main;

  const systemPrompt = loadAgentMarkdown("mainAgent.md");
  _main = {
    id: "main-quarterback",
    name: "Generic Main Agent (Quarterback)",
    version: "v2.0",
    systemPrompt,
  };
  return _main;
}
