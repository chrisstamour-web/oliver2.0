// src/lib/agents/qb/index.ts
import type { ChatMessage } from "@/lib/llm/types";
import { decideRouteWithQb } from "./qbRouter";

export { decideRouteWithQb };
export type { QbDecision, QbRoute } from "./qbRouter";
