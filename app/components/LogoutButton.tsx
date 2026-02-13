"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const BRAND = "#49257a";

export default function LogoutButton({
  brandColor = BRAND,
}: {
  brandColor?: string;
}) {
  const router = useRouter();

  async function onLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();

    // send them to login (adjust if your route differs)
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-neutral-50"
      style={{ borderColor: brandColor, color: brandColor }}
      title="Log out"
    >
      Log out
    </button>
  );
}
