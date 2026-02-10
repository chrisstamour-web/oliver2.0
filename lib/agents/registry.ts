// src/lib/agents/registry.ts
import { MAIN_AGENT } from "./mainAgent";

export type Agent = {
  id: string;
  name: string;
  version: string;
  systemPrompt: string;
};

const AGENTS = {
  main: MAIN_AGENT,
} satisfies Record<string, Agent>;

export type AgentKey = keyof typeof AGENTS;

export function getAgent(key: AgentKey = "main"): Agent {
  return AGENTS[key];
}
