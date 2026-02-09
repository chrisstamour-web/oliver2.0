// app/page.tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateThread } from "./actions/getOrCreateThread";
import ChatPanel from "@/app/components/ChatPanel";
import MainHeader from "./components/MainHeader";

const BRAND = "#49257a";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/login");

  const threadId = await getOrCreateThread();

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("Failed to load chat_messages:", error.message);
  }

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <main style={{ maxWidth: 820, margin: "28px auto", padding: 16 }}>
        {/* 👇 This wrapper forces header + chat to share the same centered width */}
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <MainHeader />

          <ChatPanel
            threadId={threadId}
            initialMessages={(messages ?? []) as any[]}
            brandColor={BRAND}
          />
        </div>
      </main>
    </div>
  );
}
