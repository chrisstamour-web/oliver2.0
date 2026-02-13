// app/api/chat/clear-thread/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { supabase, tenantId, user } = await getTenantIdOrThrow();

    const body = await req.json().catch(() => ({}));
    const threadId = body?.thread_id;

    if (!threadId || typeof threadId !== "string") {
      return NextResponse.json(
        { ok: false, error: "thread_id required" },
        { status: 400 }
      );
    }

    // Verify ownership (tenant + owner_user_id)
    const { data: threadRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", threadId)
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }
    if (!threadRow) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    // Delete ALL messages in this thread (tenant-scoped)
    const { data: deleted, error: dErr } = await supabase
      .from("chat_messages")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("thread_id", threadId)
      .select("id");

    if (dErr) {
      return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: deleted?.length ?? 0 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
