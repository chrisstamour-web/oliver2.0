import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  // ✅ Require logged-in user (recommended)
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const thread_id = body?.thread_id;

  // ✅ For your current UI, thread_id should always be provided
  if (!thread_id || typeof thread_id !== "string") {
    return NextResponse.json(
      { ok: false, error: "thread_id required" },
      { status: 400 }
    );
  }

  // ✅ Delete all messages in this thread

  const { data, error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("thread_id", thread_id)
    .select("id");

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
