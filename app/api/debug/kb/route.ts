import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: kb, error: kbErr } = await supabase
    .from("kb_items")
    .select("id,title,summary,updated_at")
    .order("updated_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: !kbErr,
    count: kb?.length ?? 0,
    error: kbErr?.message ?? null,
    kb,
  });
}
