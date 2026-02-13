import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    // Optional: if exchange fails, send them to a safe place
    if (error) {
      return NextResponse.redirect(`${url.origin}/login?error=oauth_exchange_failed`);
    }
  }

  return NextResponse.redirect(`${url.origin}${next}`);
}
