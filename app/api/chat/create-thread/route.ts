// app/api/chat/create-thread/route.ts
import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

export const runtime = "nodejs";

export async function POST() {
  const { supabase, tenantId, user } = await getTenantIdOrThrow();

  // ✅ Create thread owned by this user (required by your RLS policies)
  const { data: thread, error } = await supabase
    .from("chat_threads")
    .insert({
      tenant_id: tenantId,
      owner_user_id: user.id,
      title: null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, thread_id: thread.id });
}
