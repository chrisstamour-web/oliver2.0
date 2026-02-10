"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getOrCreateThread() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    throw new Error("Not authenticated");
  }

  // Load tenant_id for this user
  // NOTE: If your profiles table uses user_id instead of id, change `.eq("id", ...)` to `.eq("user_id", ...)`
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (pErr) throw new Error(`Failed to load profile: ${pErr.message}`);
  if (!profile?.tenant_id) throw new Error("No tenant_id found for this user.");

  const tenantId = profile.tenant_id as string;

  // 1) Try to find the most recent thread for THIS tenant
  const { data: threads, error: tErr } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (tErr) throw new Error(`Failed to find thread: ${tErr.message}`);

  if (threads && threads.length > 0) {
    return threads[0].id as string;
  }

  // 2) Otherwise create one (must include tenant_id)
  const { data: newThread, error: cErr } = await supabase
    .from("chat_threads")
    .insert({
      tenant_id: tenantId,
      title: "New chat",
    })
    .select("id")
    .single();

  if (cErr) throw new Error(`Failed to create thread: ${cErr.message}`);

  return newThread.id as string;
}
