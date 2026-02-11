import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

const BRAND = "#49257a";

function prettyDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return "";
  }
}

export default async function HistoryPage() {
  const { supabase, tenantId } = await getTenantIdOrThrow();

const { data: threads, error } = await supabase
  .from("chat_threads")
  // ✅ Only threads with at least one message
  .select("id, title, updated_at, created_at, account_id, chat_messages!inner(id)")
  .eq("tenant_id", tenantId)
  .order("updated_at", { ascending: false })
  .limit(50);

  if (error) {
    return (
      <div className="min-h-[100dvh] w-full bg-white">
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          <h1 className="text-xl font-semibold" style={{ color: BRAND }}>
            Chat history
          </h1>
          <p className="mt-3 text-sm text-neutral-600">{error.message}</p>
          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              style={{ background: BRAND }}
            >
              Back to chat
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Best-effort fallback title from first user message
  const threadIds = (threads ?? []).map((t) => t.id);
  const firstUserMsgByThread: Record<string, string> = {};

  if (threadIds.length) {
    const { data: earlyMsgs } = await supabase
      .from("chat_messages")
      .select("thread_id, content, created_at, role")
      .in("thread_id", threadIds)
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .limit(200);

    if (earlyMsgs?.length) {
      for (const m of earlyMsgs) {
        const tid = m.thread_id as string;
        if (!firstUserMsgByThread[tid] && typeof m.content === "string") {
          firstUserMsgByThread[tid] = m.content;
        }
      }
    }
  }


  return (
    <div className="min-h-[100dvh] w-full bg-white">
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold" style={{ color: BRAND }}>
            Chat history
          </h1>

<div className="flex items-center gap-2">
  <Link
    href="/"
    className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-neutral-50"
  >
    Back
  </Link>
</div>

        </div>

        <div className="mt-6 space-y-2">
          {(threads ?? []).length ? (
            threads!.map((t) => {
              const rawTitle = t.title?.trim();
              const fallback = firstUserMsgByThread[t.id]?.trim();

              const displayTitle =
                rawTitle ||
                (fallback
                  ? fallback.slice(0, 52) + (fallback.length > 52 ? "…" : "")
                  : "Untitled thread");

              return (
                <Link
                  key={t.id}
                  href={`/?thread=${encodeURIComponent(t.id)}`}
                  className="block rounded-2xl border p-4 hover:bg-neutral-50"
                >
                  <div className="text-sm font-semibold text-neutral-900">
                    {displayTitle}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {prettyDate(t.updated_at ?? t.created_at)}
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="rounded-2xl border p-4 text-sm text-neutral-600">
              No threads yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
