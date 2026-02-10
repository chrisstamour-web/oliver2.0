// app/page.tsx
import { redirect } from "next/navigation";
import ChatPanel from "@/app/components/ChatPanel";
import MainHeader from "./components/MainHeader";
import ChatHistoryButton from "./components/ChatHistoryButton";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

const BRAND = "#49257a";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { supabase, tenantId } = await getTenantIdOrThrow();

  const sp = await searchParams;
  const requestedThreadId = sp?.thread ?? null;

  // No default thread creation anymore
  const threadId: string | null = requestedThreadId ?? null;

  // Verify requested thread belongs to this tenant
  if (threadId) {
    const { data: tRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tErr) {
      console.warn("Thread ownership check failed:", tErr.message);
      redirect("/");
    }

    if (!tRow) redirect("/");
  }

  // Only load messages if we have a threadId
  let initialMessages: { id: string; role: string; content: string; created_at: string }[] = [];

  if (threadId) {
    const { data: messages, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("thread_id", threadId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Failed to load chat_messages:", error.message);
    } else {
      initialMessages = (messages ?? []) as any;
    }
  }

  return (
    <div className="min-h-[100dvh] w-full bg-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-3 sm:px-4">
        <div className="sticky top-0 z-10 bg-white/80 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <MainHeader />
            <ChatHistoryButton brandColor={BRAND} />
          </div>
        </div>

        <main className="flex flex-1 min-h-0 flex-col overflow-hidden pb-3">
          <ChatPanel
            threadId={threadId}
            initialMessages={initialMessages}
            brandColor={BRAND}
          />
        </main>
      </div>
    </div>
  );
}
