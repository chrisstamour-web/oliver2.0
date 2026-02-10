import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function getTenantIdOrThrow() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  // Assumes profiles has: id (auth user id) + tenant_id
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!profile?.tenant_id) throw new Error("No tenant_id found for this user.");

  return { supabase, userId: data.user.id, tenantId: profile.tenant_id as string };
}
