"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type Candidate = { account_id: string; name: string; score: number };

function pickAccount(candidates: Candidate[]) {
  const top = candidates[0];
  const second = candidates[1];

  if (!top) return { kind: "none" as const };

  const topScore = top.score ?? 0;
  const secondScore = second?.score ?? 0;
  const margin = topScore - secondScore;

  // ✅ Auto-link only when confident + clearly best
  if (topScore >= 0.68 && margin >= 0.08) {
    return { kind: "auto" as const, account_id: top.account_id, name: top.name, score: topScore };
  }

  // 🤔 Ask for clarification when we have plausible options
  if (topScore >= 0.45) {
    return { kind: "clarify" as const, options: candidates.slice(0, 3) };
  }

  return { kind: "none" as const };
}

export async function sendMessage(threadId: string, content: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) throw new Error("Not authenticated");
  if (!content.trim()) return;

  // Get tenant_id from profile (RLS-safe)
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("tenant_id")
    .single();

  if (profileErr) throw profileErr;
  const tenant_id = profile!.tenant_id;

  // 1) Insert user message (we'll update it with candidates afterward)
  const { data: userMsg, error: msgErr } = await supabase
    .from("chat_messages")
    .insert({
      tenant_id,
      thread_id: threadId,
      role: "user",
      content: content.trim(),
    })
    .select("id")
    .single();

  if (msgErr) throw msgErr;

  // 2) Search for account candidates using SQL function
  const { data: candidatesRaw, error: searchErr } = await supabase.rpc("search_accounts", {
    p_tenant_id: tenant_id,
    p_query: content.trim(),
    p_limit: 5,
  });

  if (searchErr) {
    // If search fails, fall back to normal stub response
    await supabase.from("chat_messages").insert({
      tenant_id,
      thread_id: threadId,
      role: "assistant",
      content: `Got it. (Stub reply) You said: ${content.trim()}`,
      agent_used: "stub",
    });
    return;
  }

  const candidates: Candidate[] = (candidatesRaw ?? []).map((r: any) => ({
    account_id: r.account_id,
    name: r.name,
    score: Number(r.score ?? 0),
  }));

  // Store candidates on the user message for debugging/traceability
  await supabase
    .from("chat_messages")
    .update({ resolved_account_candidates: candidates })
    .eq("id", userMsg.id);

  const decision = pickAccount(candidates);

  // 3) If thread already has an account_id, do not override it automatically (Phase 1 safety)
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("account_id")
    .eq("id", threadId)
    .single();

  const threadHasAccount = Boolean(thread?.account_id);

  if (!threadHasAccount) {
    if (decision.kind === "auto") {
      // Auto-link the thread
      await supabase
        .from("chat_threads")
        .update({
          account_id: decision.account_id,
          last_account_confidence: decision.score,
        })
        .eq("id", threadId);

      await supabase.from("chat_messages").insert({
        tenant_id,
        thread_id: threadId,
        role: "assistant",
        agent_used: "system.account_resolution",
        content: `Got it — I’ll treat this as **${decision.name}**. What happened in the meeting / what’s the latest?`,
      });

      return;
    }

    if (decision.kind === "clarify") {
      const lines = decision.options
        .map((o, i) => `${i + 1}) ${o.name}`)
        .join("\n");

      await supabase.from("chat_messages").insert({
        tenant_id,
        thread_id: threadId,
        role: "assistant",
        agent_used: "system.account_resolution",
        content:
          `Quick check — which account do you mean?\n\n${lines}\n\nReply with 1, 2, or 3 (or type the exact name).`,
      });

      return;
    }
  }

  // 4) Default assistant reply (stub for now)
  await supabase.from("chat_messages").insert({
    tenant_id,
    thread_id: threadId,
    role: "assistant",
    content: `Got it. (Stub reply) You said: ${content.trim()}`,
    agent_used: "stub",
  });
}
