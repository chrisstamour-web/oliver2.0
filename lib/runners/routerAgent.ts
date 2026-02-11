// src/lib/runners/routerAgent.ts
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

let _router: { id: string; name: string; version: string; systemPrompt: string } | null = null;

export function loadRouterAgent() {
  if (_router) return _router;

  const systemPrompt = loadAgentMarkdown("routerAgent.md");
  _router = {
    id: "qb-router",
    name: "Quarterback Router Agent",
    version: "v1.0",
    systemPrompt,
  };
  return _router;
}
