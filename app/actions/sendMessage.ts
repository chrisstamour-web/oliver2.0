"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  // 1) Insert user message
  const { error: msgErr } = await supabase.from("chat_messages").insert({
    tenant_id,
    thread_id: threadId,
    role: "user",
    content: content.trim(),
  });

  if (msgErr) throw msgErr;

  // 2) Placeholder assistant message (we’ll replace this with agents soon)
  const { error: botErr } = await supabase.from("chat_messages").insert({
    tenant_id,
    thread_id: threadId,
    role: "assistant",
    content: `Got it. (Stub reply) You said: ${content.trim()}`,
    agent_used: "stub",
  });

  if (botErr) throw botErr;
}
