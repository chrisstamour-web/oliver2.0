"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/llm/types";
import { callClaude } from "@/lib/llm/claude";
import { callPerplexity } from "@/lib/llm/perplexity";
import { extractOrgNameWithClaude } from "@/lib/agents/orgExtractor";
import { decideResearchWithClaude } from "@/lib/agents/researchRouter";

type Candidate = { account_id: string; name: string; score: number };

function pickAccount(candidates: Candidate[]) {
  const top = candidates[0];
  const second = candidates[1];

  if (!top) return { kind: "none" as const };

  const topScore = top.score ?? 0;
  const secondScore = second?.score ?? 0;
  const margin = topScore - secondScore;

  if (topScore >= 0.68 && margin >= 0.08) {
    return {
      kind: "auto" as const,
      account_id: top.account_id,
      name: top.name,
      score: topScore,
    };
  }

  if (topScore >= 0.45) {
    return { kind: "clarify" as const, options: candidates.slice(0, 3) };
  }

  return { kind: "none" as const };
}

function parseSelection(text: string) {
  const t = (text ?? "").trim();
  if (t === "1" || t === "2" || t === "3") return Number(t);
  return null;
}

function buildTenantContext(args: { accountName?: string | null }) {
  const lines: string[] = [
    "You are Oliver: a chat-first sales copilot for selling into hospitals and regulated healthcare orgs.",
    "Be crisp, structured, pragmatic. Prefer bullets and short sections.",
    "Avoid making up facts. If you need up-to-date info, request research.",
  ];

  if (args.accountName) {
    lines.push(`Target organization for this thread: ${args.accountName}`);
  }

  return lines.join("\n");
}

function formatResearchForClaude(research: {
  answer: string;
  citations?: Array<{ title?: string; url?: string }>;
}) {
  const cits =
    research.citations?.length
      ? `\nCITATIONS:\n${research.citations
          .map((c) => `- ${c.title ?? "Source"}: ${c.url ?? ""}`.trim())
          .join("\n")}\n`
      : "";

  return `\n\n---\nWEB RESEARCH (Perplexity)\n${research.answer}\n${cits}`.trim();
}

function normalizeForMatch(s: string) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function messageMentionsOrg(userText: string, accountName: string | null) {
  if (!accountName) return false;

  const t = normalizeForMatch(userText);
  const o = normalizeForMatch(accountName);
  if (!t || !o) return false;

  if (t.includes(o)) return true;

  // acronym mention: if accountName contains an acronym, allow that too
  const acr = accountName.match(/\b[A-Z]{2,10}\b/g);
  if (acr?.length) {
    const acrs = acr.map((x) => x.toLowerCase());
    return acrs.some((a) => t.includes(a));
  }

  return false;
}

export async function sendMessage(threadId: string, content: string) {
  const supabase = await createSupabaseServerClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  const userText = (content ?? "").trim();
  if (!userText) return;

  // tenant_id from profile (RLS-safe)
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("tenant_id")
    .single();

  if (profileErr) throw profileErr;
  const tenant_id = profile!.tenant_id as string;

  // 1) Insert user message
  const { data: userMsg, error: msgErr } = await supabase
    .from("chat_messages")
    .insert({
      tenant_id,
      thread_id: threadId,
      role: "user",
      content: userText,
    })
    .select("id")
    .single();

  if (msgErr) throw msgErr;

  // 2) Load thread (account_id)
  const { data: thread, error: threadErr } = await supabase
    .from("chat_threads")
    .select("account_id")
    .eq("id", threadId)
    .single();

  if (threadErr) throw threadErr;

  let account_id: string | null = thread?.account_id ?? null;
  let account_name: string | null = null;

  // If we have an account_id, fetch account name for context
  if (account_id) {
    const { data: acc } = await supabase
      .from("accounts")
      .select("name")
      .eq("id", account_id)
      .single();
    account_name = (acc?.name ?? null) as any;
  }

  // --- Handle "reply with 1/2/3" selection (clarify loop) ---
  // IMPORTANT: If user replies "1", we should link and STOP (do not call Claude on "1")
  if (!account_id) {
    const selection = parseSelection(userText);

    // Look back at the most recent user message BEFORE this one to find stored candidates
    const { data: prevUserMsgs } = await supabase
      .from("chat_messages")
      .select("resolved_account_candidates")
      .eq("tenant_id", tenant_id)
      .eq("thread_id", threadId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .range(1, 1); // index 0 = current user msg, index 1 = previous user msg

    const prev = prevUserMsgs?.[0] as any;
    const candidatesPrev: Candidate[] = Array.isArray(prev?.resolved_account_candidates)
      ? prev.resolved_account_candidates
      : [];

    // A) Numeric selection 1/2/3
    if (selection && candidatesPrev.length >= selection) {
      const chosen = candidatesPrev[selection - 1];

      if (chosen?.account_id) {
        await supabase
          .from("chat_threads")
          .update({
            account_id: chosen.account_id,
            last_account_confidence: chosen.score,
          })
          .eq("id", threadId);

        await supabase.from("chat_messages").insert({
          tenant_id,
          thread_id: threadId,
          role: "assistant",
          agent_used: "system.account_resolution",
          content: `Perfect — linked to **${chosen.name}**. What do you want to do next?`,
        });

        return;
      }
    }

    // B) Exact-name match with a prior candidate
    if (!account_id && candidatesPrev.length) {
      const typed = normalizeForMatch(userText);
      const match = candidatesPrev.find((c) => normalizeForMatch(c.name) === typed);

      if (match?.account_id) {
        await supabase
          .from("chat_threads")
          .update({
            account_id: match.account_id,
            last_account_confidence: match.score,
          })
          .eq("id", threadId);

        await supabase.from("chat_messages").insert({
          tenant_id,
          thread_id: threadId,
          role: "assistant",
          agent_used: "system.account_resolution",
          content: `Perfect — linked to **${match.name}**. What do you want to do next?`,
        });

        return;
      }
    }
  }

  // 3) If no account_id, run resolution (candidates → clarify/auto → else Claude extract)
  if (!account_id) {
    const { data: candidatesRaw, error: searchErr } = await supabase.rpc(
      "search_accounts",
      {
        p_tenant_id: tenant_id,
        p_query: userText,
        p_limit: 5,
      }
    );

    if (!searchErr) {
      const candidates: Candidate[] = (candidatesRaw ?? []).map((r: any) => ({
        account_id: r.account_id,
        name: r.name,
        score: Number(r.score ?? 0),
      }));

      // Store candidates for debugging/traceability
      await supabase
        .from("chat_messages")
        .update({ resolved_account_candidates: candidates })
        .eq("id", userMsg.id);

      const decision = pickAccount(candidates);

      if (decision.kind === "auto") {
        await supabase
          .from("chat_threads")
          .update({
            account_id: decision.account_id,
            last_account_confidence: decision.score,
          })
          .eq("id", threadId);

        account_id = decision.account_id;
        account_name = decision.name;

        await supabase.from("chat_messages").insert({
          tenant_id,
          thread_id: threadId,
          role: "assistant",
          agent_used: "system.account_resolution",
          content: `Got it — I’ll treat this as **${decision.name}**.`,
        });
      } else if (decision.kind === "clarify") {
        const lines = decision.options.map((o, i) => `${i + 1}) ${o.name}`).join("\n");

        await supabase.from("chat_messages").insert({
          tenant_id,
          thread_id: threadId,
          role: "assistant",
          agent_used: "system.account_resolution",
          content: `Quick check — which account do you mean?\n\n${lines}\n\nReply with 1, 2, or 3 (or type the exact name).`,
        });

        return;
      } else {
        // none → Claude extraction
        const extracted = await extractOrgNameWithClaude({ userText });
        const THRESHOLD = 0.7;

        if (!extracted.ok || !extracted.org_name || extracted.confidence < THRESHOLD) {
          await supabase.from("chat_messages").insert({
            tenant_id,
            thread_id: threadId,
            role: "assistant",
            agent_used: "system.org_extraction",
            content:
              "Quick clarification — what’s the **hospital / organization name** you mean? (e.g., MUHC, CHUM, Toronto General Hospital)",
          });
          return;
        }

        const { data: newAccount, error: accErr } = await supabase
          .from("accounts")
          .insert({
            tenant_id,
            name: extracted.org_name,
          })
          .select("id, name")
          .single();

        if (accErr || !newAccount?.id) {
          await supabase.from("chat_messages").insert({
            tenant_id,
            thread_id: threadId,
            role: "assistant",
            agent_used: "system.org_extraction",
            content:
              "I found the organization name, but I couldn’t create it in the system. Want to try again?",
          });
          return;
        }

        await supabase
          .from("chat_threads")
          .update({
            account_id: newAccount.id,
            last_account_confidence: extracted.confidence,
          })
          .eq("id", threadId);

        account_id = newAccount.id;
        account_name = newAccount.name;

        await supabase.from("chat_messages").insert({
          tenant_id,
          thread_id: threadId,
          role: "assistant",
          agent_used: "system.org_extraction",
          content: `Got it — I linked this thread to **${newAccount.name}**.`,
        });
      }
    }
    // If searchErr occurs, we skip resolution and proceed with chat anyway.
  }

  // 4) Load recent messages for assistant response (tenant-filtered)
  const { data: recent, error: recentErr } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("tenant_id", tenant_id)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(20);

  if (recentErr) throw recentErr;

  const messages: ChatMessage[] = (recent ?? []).map((m: any) => ({
    role: m.role,
    content: String(m.content ?? ""),
  }));

  // 5) Router: decide whether we need Perplexity
  const tenantContext = buildTenantContext({ accountName: account_name });

  const router = await decideResearchWithClaude({
    messages: [{ role: "system", content: tenantContext }, ...messages],
  });

  let researchText = "";
  let researchMeta: any = null;

  if (router.ok && router.decision.needs_research && router.decision.queries.length) {
    const q = router.decision.queries[0];

    const research = await callPerplexity({
      messages: [
        {
          role: "system",
          content:
            "You are a web-grounded research assistant. Provide a concise brief with sources/citations if available.",
        },
        { role: "user", content: `Research query: ${q}\n\nUser need: ${userText}` },
      ],
      maxTokens: 900,
    });

    if (research.ok && research.answer) {
      researchText = formatResearchForClaude(research);
      researchMeta = {
        reason: router.decision.reason,
        query: q,
        citations: research.citations ?? [],
      };
    } else {
      researchMeta = {
        reason: router.decision.reason,
        query: q,
        error: research.error,
      };
    }
  }

  // 6) Claude final response
  const orgMentionedThisTurn = messageMentionsOrg(userText, account_name);

  const system = [
    tenantContext,
    "You are Oliver, a concise sales copilot.",
  "Critical rule: Do NOT mention or assume any organization unless the user explicitly mentions it in their latest message. If you need the org to help, ask: 'Which organization/hospital is this about?'",
orgMentionedThisTurn
  ? "The user explicitly mentioned the org in their latest message; you may use it."
  : "The user did NOT explicitly mention the org; do not reference the linked org by name.",

    researchText ? researchText : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const final = await callClaude({
    system,
    messages,
    maxTokens: 900,
  });

  if (!final.ok) {
    await supabase.from("chat_messages").insert({
      tenant_id,
      thread_id: threadId,
      role: "assistant",
      agent_used: "system.error",
      content: "I hit an issue generating a reply. Try again?",
    });
    return;
  }

  await supabase.from("chat_messages").insert({
    tenant_id,
    thread_id: threadId,
    role: "assistant",
    agent_used: researchText ? "claude+perplexity" : "claude",
    content: final.text,
  });

  void researchMeta;
}
