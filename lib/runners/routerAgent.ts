// src/lib/runners/routerAgent.ts
import "server-only";

import { loadPromptMarkdown } from "@/lib/agents/promptLoader";

let _router:
  | { id: string; name: string; version: string; systemPrompt: string }
  | null = null;

export function loadRouterAgent() {
  if (_router) return _router;

  const systemPrompt = loadPromptMarkdown("routerAgent.md");

  _router = {
    id: "qb-router",
    name: "Quarterback Router Agent",
    version: "v1.0",
    systemPrompt,
  };

  return _router;
}
