// src/lib/agents/mainAgent.ts
import fs from "fs";
import path from "path";

function loadAgentMarkdown(filename: string) {
  // supports both repos with /src and without /src
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", filename),
    path.join(process.cwd(), "lib", "agents", filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const instructions = fs.readFileSync(p, "utf8");
      return { instructions, foundPath: p };
    }
  }

  throw new Error(`${filename} not found. Tried:\n- ${candidates.join("\n- ")}`);
}

export function loadMainAgent() {
  const { instructions } = loadAgentMarkdown("mainAgent.md");

  return {
    id: "main-quarterback",
    name: "Generic Main Agent (Quarterback)",
    version: "v2.0",
    systemPrompt: instructions,
  } as const;
}

// optional convenience export
export const MAIN_AGENT = loadMainAgent();
