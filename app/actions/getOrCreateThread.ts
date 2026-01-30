"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getOrCreateThread() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    throw new Error("Not authenticated");
  }

  // 1) Try to find the most recent thread
  const { data: threads } = await supabase
    .from("chat_threads")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);

  if (threads && threads.length > 0) {
    return threads[0].id;
  }

  // 2) Otherwise create one
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .single();

  const { data: newThread, error } = await supabase
    .from("chat_threads")
    .insert({
      tenant_id: profile!.tenant_id,
    })
    .select("id")
    .single();

  if (error) throw error;

  return newThread.id;
}
