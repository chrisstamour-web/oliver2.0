import "server-only";

import fs from "fs";
import path from "path";

export function loadPromptMarkdown(filename: string) {
  const f = String(filename ?? "").replace(/^\/+/, ""); // avoid absolute-ish paths

  const candidates = [
    // with /src
    path.join(process.cwd(), "src", "lib", "agents", "prompts", f),
    // without /src
    path.join(process.cwd(), "lib", "agents", "prompts", f),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return {
        text: fs.readFileSync(p, "utf8"),
        foundPath: p,
      };
    }
  }

  throw new Error(`${f} not found. Tried:\n- ${candidates.join("\n- ")}`);
}
