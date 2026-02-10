"use server";

import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { extractOrgNameWithClaude } from "@/lib/agents/orgExtractor";

function normalizeOrgName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function sendMessage(args: {
  threadId: string | null;
  content: string;
}) {
  const content = (args.content ?? "").trim();
  if (!content) throw new Error("Empty message");

  const { supabase, tenantId } = await getTenantIdOrThrow();

  let threadId = args.threadId;
  let createdNewThread = false;

  // 1) Create thread if needed
  if (!threadId) {
    const { data: created, error: cErr } = await supabase
      .from("chat_threads")
      .insert({
        tenant_id: tenantId,
        title: null,
        account_id: null,
      })
      .select("id")
      .single();

    if (cErr) throw new Error(`Failed to create thread: ${cErr.message}`);
    threadId = created.id as string;
    createdNewThread = true;
  } else {
    // safety: ensure thread belongs to tenant
    const { data: tRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, account_id")
      .eq("id", threadId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tErr) throw new Error(`Thread check failed: ${tErr.message}`);
    if (!tRow) throw new Error("Thread not found for this tenant.");
  }

  // 2) If this is a brand-new thread, try to attach an account
  if (createdNewThread) {
    try {
      const org = await extractOrgNameWithClaude({
        userText: content,
        recentMessages: [],
      });

      if (org.ok && org.org_name && org.confidence >= 0.75) {
        const name = org.org_name.trim();
        const name_normalized = normalizeOrgName(name);

        // Upsert account by (tenant_id, name_normalized)
        const { data: acct, error: aErr } = await supabase
          .from("accounts")
          .upsert(
            {
              tenant_id: tenantId,
              name,
              name_normalized,
            },
            { onConflict: "tenant_id,name_normalized" }
          )
          .select("id,name")
          .single();

        if (!aErr && acct?.id) {
          // Link thread → account + set a nice thread title
          await supabase
            .from("chat_threads")
            .update({ account_id: acct.id, title: acct.name })
            .eq("id", threadId)
            .eq("tenant_id", tenantId);
        }
      }
    } catch (e) {
      // Never block sending if extraction fails
      console.warn("orgExtractor failed (continuing):", e);
    }
  }

  // 3) Insert the user message
  const { error: mErr } = await supabase.from("chat_messages").insert({
    tenant_id: tenantId,
    thread_id: threadId,
    role: "user",
    content,
  });

  if (mErr) throw new Error(`Failed to insert message: ${mErr.message}`);

  // 4) Touch thread updated_at
  await supabase
    .from("chat_threads")
    .update({ title: null }) // triggers updated_at if you have trigger
    .eq("id", threadId)
    .eq("tenant_id", tenantId);

  return { threadId };
}
