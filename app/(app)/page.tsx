// app/page.tsx
import { redirect } from "next/navigation";
import ChatPanel from "@/app/components/ChatPanel";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

const BRAND = "#49257a";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { supabase, tenantId, user } = await getTenantIdOrThrow();

  const sp = await searchParams;
  const requestedThreadId = sp?.thread ?? null;

  const threadId: string | null = requestedThreadId ?? null;

  let threadTitle: string | null = null;

  // Verify requested thread belongs to this tenant + this user
  if (threadId) {
    const { data: tRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, title")
      .eq("id", threadId)
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (tErr) {
      console.warn("Thread ownership check failed:", tErr.message);
      redirect("/");
    }

    if (!tRow) redirect("/");

    threadTitle = (tRow.title ?? null) as any;
  }

  // Only load messages if we have a threadId
  let initialMessages: {
    id: string;
    role: string;
    content: string;
    created_at: string;
  }[] = [];

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
    <div className="mx-auto h-full w-full max-w-5xl px-4 py-6">
      <div className="flex h-full flex-col">
        <ChatPanel
          threadId={threadId}
          threadTitle={threadTitle}
          initialMessages={initialMessages}
          brandColor={BRAND}
        />
      </div>
    </div>
  );
}
