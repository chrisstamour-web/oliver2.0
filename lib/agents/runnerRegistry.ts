// src/lib/agents/runnerRegistry.ts
import "server-only";

import { runIcpFit } from "@/lib/runners/icpFit";

export const RUNNERS = {
  icpFit: runIcpFit,
  // later: stakeholderMap: runStakeholderMap,
  // later: accountBrief: runAccountBrief,
} as const;

export type RunnerId = keyof typeof RUNNERS;

export function getRunner(id: RunnerId) {
  return RUNNERS[id];
}
