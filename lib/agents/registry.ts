import { MAIN_AGENT } from "./mainAgent";
import { ICP_FIT_AGENT } from "./icpFit";

export type Agent = {
  id: string;
  name: string;
  version: string;
  systemPrompt: string;
};

const AGENTS = {
  main: MAIN_AGENT,
  icpFit: ICP_FIT_AGENT,
} satisfies Record<string, Agent>;

export type AgentKey = keyof typeof AGENTS;

export function getAgent(key: AgentKey = "main"): Agent {
  return AGENTS[key];
}
