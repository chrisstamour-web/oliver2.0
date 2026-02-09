import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ✅ DEBUG: confirm KB is readable from Supabase
  const { data: kb, error: kbErr } = await supabase
    .from("kb_items")
    .select("id,title,summary,updated_at")
    .order("updated_at", { ascending: false })
    .limit(10);

  console.log("KB CHECK", { count: kb?.length ?? 0, kbErr, kb });

  const body = await req.json().catch(() => ({}));
  const thread_id = body?.thread_id;

  if (!thread_id || typeof thread_id !== "string") {
    return NextResponse.json({ ok: false, error: "thread_id required" }, { status: 400 });
  }

  // ✅ Delete all messages for this thread
  const { data, error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("thread_id", thread_id)
    .select("id");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
