"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { redirect } from "next/navigation";

export async function sendMessage(args: {
  threadId: string | null;
  content: string;
}) {
  const content = (args.content ?? "").trim();
  if (!content) throw new Error("Empty message");

  // Use your existing helper (tenant-scoped)
  const { supabase, tenantId } = await getTenantIdOrThrow();

  let threadId = args.threadId;

  // If no thread yet, create one (but ONLY now)
  if (!threadId) {
    const { data: created, error: cErr } = await supabase
      .from("chat_threads")
      .insert({
        tenant_id: tenantId,
        title: null, // optional
      })
      .select("id")
      .single();

    if (cErr) throw new Error(`Failed to create thread: ${cErr.message}`);
    threadId = created.id as string;
  } else {
    // Optional safety: ensure thread belongs to tenant
    const { data: tRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tErr) throw new Error(`Thread check failed: ${tErr.message}`);
    if (!tRow) throw new Error("Thread not found for this tenant.");
  }

  // Insert the user message (tenant_id is NOT NULL in your schema)
  const { error: mErr } = await supabase.from("chat_messages").insert({
    tenant_id: tenantId,
    thread_id: threadId,
    role: "user",
    content,
  });

  if (mErr) throw new Error(`Failed to insert message: ${mErr.message}`);

  // Touch thread updated_at by forcing an update (your trigger will set updated_at)
  await supabase
    .from("chat_threads")
    .update({ title: null })
    .eq("id", threadId)
    .eq("tenant_id", tenantId);

  return { threadId };
}
