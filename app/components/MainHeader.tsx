"use client";

import Image from "next/image";
import { Montserrat } from "next/font/google";
import { useEffect, useState } from "react";

import LogoutButton from "@/app/components/LogoutButton";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const BRAND = "#49257a";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function MainHeader(props: {
  threadId?: string | null;
  hasMessages?: boolean;
  brandColor?: string;
}) {
  const brandColor = props.brandColor ?? BRAND;

  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;
      if (error) return setEmail(null);
      setEmail(data.user?.email ?? null);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto w-full max-w-5xl px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid #eee",
                background: "#fff",
                flex: "0 0 auto",
              }}
            >
              <Image
                src="/logo.png"
                alt="Oliver"
                width={42}
                height={42}
                priority
              />
            </div>

            <div style={{ lineHeight: 1.05 }}>
              <div
                className="flex items-baseline gap-2"
                style={{ fontWeight: 900, color: brandColor }}
              >
                <span style={{ fontSize: 18 }}>Oliver</span>
                <span
                  className={montserrat.className}
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#64748b",
                  }}
                >
                  your Pathova Assistant
                </span>
              </div>
            </div>
          </div>

          {/* User + logout */}
          <div className="ml-auto flex items-center gap-3">
            <div className="max-w-[260px] truncate text-sm font-medium text-slate-700">
              {email ?? "Signed in"}
            </div>

            <LogoutButton brandColor={brandColor} />
          </div>
        </div>
      </div>
    </header>
  );
}
