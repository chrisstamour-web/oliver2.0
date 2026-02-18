// src/lib/runners/mainAgent.ts
import "server-only";

import fs from "fs";
import path from "path";

export type Agent = {
  id: string;
  name: string;
  version: string;
  systemPrompt: string;
};

let _mainAgent: Agent | null = null;

function normBase(s: string) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function loadPromptByBasename(basename: string): string {
  const dirs = [
    path.join(process.cwd(), "src", "lib", "agents", "prompts"),
    path.join(process.cwd(), "lib", "agents", "prompts"),
  ];

  const want = normBase(basename);

  // Common filename variants (so you don't have to rename md files)
  const variants = Array.from(
    new Set([
      `${basename}.md`,
      `${basename}.MD`,
      // mainAgent -> "main agent"
      `${basename.replace(/([a-z])([A-Z])/g, "$1 $2")}.md`,
      `${basename.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}.md`,
      // mainAgent -> main_agent / main-agent
      `${basename.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}.md`,
      `${basename.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}.md`,
    ])
  );

  for (const dir of dirs) {
    // 1) Try explicit variant names first
    for (const file of variants) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    }

    // 2) Fallback: scan directory and match by normalized basename
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".md")) continue;
        const base = path.basename(f, path.extname(f));
        if (normBase(base) === want) {
          const p = path.join(dir, f);
          return fs.readFileSync(p, "utf8");
        }
      }
    }
  }

  throw new Error(
    `Prompt not found: ${basename}.md\nLooked in:\n- ${dirs.join("\n- ")}\nTried names:\n- ${variants.join(
      "\n- "
    )}`
  );
}

export function loadMainAgent(): Agent {
  if (_mainAgent) return _mainAgent;

  const systemPrompt = loadPromptByBasename("mainAgent");

  _mainAgent = {
    id: "mainAgent",
    name: "Quarterback Agent",
    version: "3.0",
    systemPrompt,
  };

  return _mainAgent;
}
