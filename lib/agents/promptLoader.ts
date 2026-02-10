import "server-only";
import fs from "fs";
import path from "path";

export function loadPromptMarkdown(filename: string) {
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", "prompts", filename),
    path.join(process.cwd(), "lib", "agents", "prompts", filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }

  throw new Error(`${filename} not found. Tried:\n- ${candidates.join("\n- ")}`);
}
