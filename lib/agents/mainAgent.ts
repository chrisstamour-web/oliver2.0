import fs from "fs";
import path from "path";

export function loadMainAgent() {
  // supports both repos with /src and without /src
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", "mainAgent.md"),
    path.join(process.cwd(), "lib", "agents", "mainAgent.md"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const instructions = fs.readFileSync(p, "utf8");
      return {
        id: "main-quarterback",
        name: "Generic Main Agent (Quarterback)",
        version: "v2.0",
        systemPrompt: instructions,
      } as const;
    }
  }

  throw new Error(
    `mainAgent.md not found. Tried:\n- ${candidates.join("\n- ")}`
  );
}

// optional convenience export
export const MAIN_AGENT = loadMainAgent();
