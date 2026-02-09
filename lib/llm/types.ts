export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ResearchResult = {
  ok: boolean;
  answer: string;
  citations?: Array<{ title?: string; url?: string }>;
  raw?: any;
  error?: string;
};
