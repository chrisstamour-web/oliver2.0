// app/(app)/history/page.tsx
import Link from "next/link";
import { getTenantIdOrThrow } from "@/lib/tenant/getTenantId";

const BRAND = "#49257a";

function prettyDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString([], {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type ThreadRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
  created_at: string | null;
  account_id: string | null;
};

type MsgRow = {
  id: string;
  thread_id: string;
  role: string | null;
  content: any;
  created_at: string | null;
};

export default async function HistoryPage() {
  const { supabase, tenantId, user } = await getTenantIdOrThrow();

  // 1) Load recent threads for this user (no join; safest)
  const { data: threadsRaw, error } = await supabase
    .from("chat_threads")
    .select("id, title, updated_at, created_at, account_id")
    .eq("tenant_id", tenantId)
    .eq("owner_user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) {
    return (
      <div className="min-h-[100dvh] w-full bg-slate-50">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold" style={{ color: BRAND }}>
                Chat history
              </h1>
              <Link
                href="/"
                className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                Back
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-600">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const threads = (threadsRaw ?? []) as ThreadRow[];
  const threadIds = threads.map((t) => t.id);

  // 2) Load messages for those threads (used to: a) filter threads with messages b) fallback title)
  const firstUserMsgByThread: Record<string, string> = {};
  const hasAnyMsg: Record<string, boolean> = {};

  if (threadIds.length) {
    const { data: msgs, error: mErr } = await supabase
      .from("chat_messages")
      .select("id, thread_id, role, content, created_at")
      .eq("tenant_id", tenantId)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: true })
      .limit(600);

    if (!mErr && msgs?.length) {
      for (const m of msgs as unknown as MsgRow[]) {
        const tid = String(m.thread_id ?? "");
        if (!tid) continue;

        hasAnyMsg[tid] = true;

        if (
          !firstUserMsgByThread[tid] &&
          m.role === "user" &&
          typeof m.content === "string"
        ) {
          firstUserMsgByThread[tid] = m.content;
        }
      }
    }
  }

  // 3) Keep only threads that have at least one message
  const threadsWithMessages = threads.filter((t) => hasAnyMsg[t.id]);

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold" style={{ color: BRAND }}>
              Chat history
            </h1>

            <Link
              href="/"
              className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Back
            </Link>
          </div>

          <div className="mt-6 space-y-2">
            {threadsWithMessages.length ? (
              threadsWithMessages.slice(0, 50).map((t) => {
                const rawTitle = (t.title ?? "").trim();
                const fallback = (firstUserMsgByThread[t.id] ?? "").trim();

                const displayTitle =
                  rawTitle ||
                  (fallback
                    ? fallback.slice(0, 60) + (fallback.length > 60 ? "…" : "")
                    : "Untitled thread");

                const when = prettyDate(t.updated_at ?? t.created_at);

                return (
                  <Link
                    key={t.id}
                    href={`/?thread=${encodeURIComponent(t.id)}`}
                    className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50"
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {displayTitle}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{when}</div>
                  </Link>
                );
              })
            ) : (
              <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
                No threads yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
