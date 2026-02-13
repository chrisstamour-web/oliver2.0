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

  // No default thread creation anymore
  const threadId: string | null = requestedThreadId ?? null;

  // Verify requested thread belongs to this tenant
  if (threadId) {
    const { data: tRow, error: tErr } = await supabase
      .from("chat_threads")
      .select("id")
.eq("id", threadId)
.eq("tenant_id", tenantId)
.eq("user_id", user.id)

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
.eq("user_id", user.id)

      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Failed to load chat_messages:", error.message);
    } else {
      initialMessages = (messages ?? []) as any;
    }
  }

  return (
    <ChatPanel threadId={threadId} initialMessages={initialMessages} brandColor={BRAND} />
  );
}
