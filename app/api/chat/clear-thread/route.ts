// app/api/chat/clear-thread/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function hasMissingColumnError(err: any, column: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(column.toLowerCase());
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  try {
    // 1) Auth
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const userId = authData.user.id;

    // 2) Input
    const body = await req.json().catch(() => ({}));
    const threadId = body?.thread_id;

    if (!threadId || typeof threadId !== "string") {
      return NextResponse.json({ ok: false, error: "thread_id required" }, { status: 400 });
    }

    // 3) Optional debug KB check
    if (process.env.DEBUG_KB_CHECK === "true") {
      const { data: kb, error: kbErr } = await supabase
        .from("kb_items")
        .select("id,title,summary,updated_at")
        .order("updated_at", { ascending: false })
        .limit(10);

      console.log("KB CHECK", { count: kb?.length ?? 0, kbErr });
    }

    // 4) Preferred ownership check: chat_threads.user_id
    const { data: threadRow, error: threadErr } = await supabase
      .from("chat_threads")
      .select("id,user_id")
      .eq("id", threadId)
      .maybeSingle();

    const threadsMissingUserId = hasMissingColumnError(threadErr, "user_id");

    if (threadErr && !threadsMissingUserId) {
      return NextResponse.json({ ok: false, error: threadErr.message }, { status: 500 });
    }

    // If chat_threads.user_id exists, enforce it strictly
    if (!threadsMissingUserId) {
      if (!threadRow) {
        return NextResponse.json({ ok: false, error: "thread not found" }, { status: 404 });
      }
      if ((threadRow as any).user_id !== userId) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }

      const { data, error } = await supabase
        .from("chat_messages")
        .delete()
        .eq("thread_id", threadId)
        .select("id");

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
    }

    // 5) Fallback ownership check: chat_messages.user_id
    const { data: oneMsg, error: oneMsgErr } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    const messagesMissingUserId = hasMissingColumnError(oneMsgErr, "user_id");

    // Last-resort fallback (NOT ideal): if neither table has user_id
    if (messagesMissingUserId) {
      const { data, error } = await supabase
        .from("chat_messages")
        .delete()
        .eq("thread_id", threadId)
        .select("id");

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        deleted: data?.length ?? 0,
        warning:
          "No chat_threads.user_id and no chat_messages.user_id — deletion not scoped to user. Add ownership column + RLS.",
      });
    }

    if (oneMsgErr) {
      return NextResponse.json({ ok: false, error: oneMsgErr.message }, { status: 500 });
    }

    if (!oneMsg) {
      return NextResponse.json({ ok: false, error: "thread not found" }, { status: 404 });
    }

    // 6) Scoped delete by thread_id + user_id
    const { data, error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .select("id");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
