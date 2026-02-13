// lib/tenant/getTenantId.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function getTenantIdOrThrow() {
  const supabase = await createSupabaseServerClient();

  const { data, error: uErr } = await supabase.auth.getUser();
  if (uErr || !data.user) redirect("/login");

  // Assumes profiles has: id (auth user id) + tenant_id
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!profile?.tenant_id) throw new Error("No tenant_id found for this user.");

  return {
    supabase,
    user: data.user, // ✅ return the user object so routes don't re-fetch it
    tenantId: profile.tenant_id as string,
  };
}
