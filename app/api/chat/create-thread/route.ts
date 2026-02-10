import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

export const runtime = "nodejs";

export async function POST() {
  const { supabase, tenantId } = await getTenantIdOrThrow();

  // Auth check
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Create thread
  const { data: thread, error } = await supabase
    .from("chat_threads")
    .insert({ tenant_id: tenantId, title: null })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, thread_id: thread.id });
}
