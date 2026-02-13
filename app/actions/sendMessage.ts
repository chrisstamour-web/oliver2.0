// app/actions/sendMessage.ts
"use server";

import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";
import { extractOrgNameWithClaude } from "@/lib/agents/orgExtractor";

function normalizeOrgName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function sendMessage(args: { threadId: string | null; content: string }) {
  const content = (args.content ?? "").trim();
  if (!content) throw new Error("Empty message");

  // ✅ get authenticated user too (needed for RLS + ownership)
  const { supabase, tenantId, user } = await getTenantIdOrThrow();

  let threadId = args.threadId;
  let createdNewThread = false;

  // 1) Create thread if needed (✅ must set owner_user_id)
  if (!threadId) {
    const { data: created, error: cErr } = await supabase
      .from("chat_threads")
      .insert({
        tenant_id: tenantId,
        owner_user_id: user.id, // ✅ REQUIRED for your chat_threads RLS
        title: null,
        account_id: null,
      })
      .select("id")
      .single();

    if (cErr) throw new Error(`Failed to create thread: ${cErr.message}`);
    threadId = created.id as string;
    createdNewThread = true;
  } else {
    // Safety: ensure thread exists + is visible to this user.
    // With RLS enabled, a thread not owned by this user will come back null.
    const { data: tRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, account_id")
      .eq("id", threadId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tErr) throw new Error(`Thread check failed: ${tErr.message}`);
    if (!tRow) throw new Error("Thread not found (or you don't have access).");
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
          // (RLS allows this because thread is owned by this user)
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

  // 3) Insert the user message (✅ set user_id)
  const { error: mErr } = await supabase.from("chat_messages").insert({
    tenant_id: tenantId,
    thread_id: threadId,
    role: "user",
    content,
    user_id: user.id, // ✅ recommended (and future-proof)
  });

  if (mErr) throw new Error(`Failed to insert message: ${mErr.message}`);

  // 4) Touch thread updated_at
  // Better than "title: null" because it won't clobber anything.
  // Your trigger will still fire on any update.
  await supabase
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("tenant_id", tenantId);

  return { threadId };
}
