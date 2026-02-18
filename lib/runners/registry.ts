import "server-only";

import { runIcpFit } from "@/lib/runners/icpFit";
import { runSalesStrategy } from "@/lib/runners/salesStrategy";
import { runStakeholderMapping } from "@/lib/runners/stakeholderMapping";
import { runDraftOutreach } from "@/lib/runners/draftOutreach";

export const RUNNERS = {
  icpFit: runIcpFit,
  salesStrategy: runSalesStrategy,
  stakeholderMapping: runStakeholderMapping,
  draftOutreach: runDraftOutreach,
} as const;

export type RunnerId = keyof typeof RUNNERS;

export function isRunnerId(x: string): x is RunnerId {
  return Object.prototype.hasOwnProperty.call(RUNNERS, x);
}

export function getRunner(id: RunnerId) {
  return RUNNERS[id];
}

export function runnerLabel(id: RunnerId): string {
  switch (id) {
    case "icpFit":
      return "ICP Fit";
    case "salesStrategy":
      return "Sales Strategy";
    case "stakeholderMapping":
      return "Stakeholder Mapping";
    case "draftOutreach":
      return "Draft Outreach";
  }
}
