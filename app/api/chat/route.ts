import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  // 1) Auth
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  // 2) Input
  const body = await req.json().catch(() => ({}));
  const thread_id = body?.thread_id;

  if (!thread_id || typeof thread_id !== "string") {
    return NextResponse.json({ ok: false, error: "thread_id required" }, { status: 400 });
  }

  // 3) (Optional) Debug KB check — only when you explicitly enable it
  if (process.env.DEBUG_KB_CHECK === "true") {
    const { data: kb, error: kbErr } = await supabase
      .from("kb_items")
      .select("id,title,summary,updated_at")
      .order("updated_at", { ascending: false })
      .limit(10);

    console.log("KB CHECK", { count: kb?.length ?? 0, kbErr });
  }

  /**
   * 4) Security: make sure the thread belongs to the current user.
   * This assumes chat_messages has a user_id column.
   *
   * If you do NOT have user_id on chat_messages, you should add it.
   * Otherwise any logged-in user could delete any thread_id they guess.
   */
  const { data: oneMsg, error: oneMsgErr } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("thread_id", thread_id)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  // If column doesn't exist, Supabase returns an error like:
  // "column chat_messages.user_id does not exist"
  const missingUserIdColumn =
    oneMsgErr?.message?.toLowerCase().includes("does not exist") &&
    oneMsgErr?.message?.toLowerCase().includes("user_id");

  if (missingUserIdColumn) {
    // Fallback (NOT ideal): delete by thread_id only
    // ✅ Recommended fix: add user_id and enforce RLS.
    const { data, error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("thread_id", thread_id)
      .select("id");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      deleted: data?.length ?? 0,
      warning: "chat_messages.user_id column missing — deletion not scoped to user.",
    });
  }

  if (oneMsgErr) {
    return NextResponse.json({ ok: false, error: oneMsgErr.message }, { status: 500 });
  }

  if (!oneMsg) {
    // Either thread doesn't exist, or it doesn't belong to this user
    return NextResponse.json({ ok: false, error: "thread not found" }, { status: 404 });
  }

  // 5) Delete only this user's messages in the thread
  const { data, error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("thread_id", thread_id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
