"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import ChatComposer from "@/app/components/ChatComposer";

type Msg = {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  created_at: string;
};

export default function ChatPanel({
  threadId,
  threadTitle,
  initialMessages,
  brandColor,
}: {
  threadId: string | null;
  threadTitle: string | null;
  initialMessages: Msg[];
  brandColor: string;
}) {
  const router = useRouter();
  const messages = useMemo(() => initialMessages ?? [], [initialMessages]);

  const ensureThreadId = useCallback(async () => {
    if (threadId) return threadId;

    const res = await fetch("/api/chat/create-thread", { method: "POST" });
    const text = await res.text();

    let j: any = {};
    try {
      j = JSON.parse(text);
    } catch {
      j = { ok: false, error: text?.slice(0, 200) || "Non-JSON response" };
    }

    if (!res.ok || !j?.ok || !j?.thread_id) {
      const msg =
        j?.error ||
        `Failed to create thread (status ${res.status}). Check auth/tenant routing.`;
      throw new Error(msg);
    }

    const tid = String(j.thread_id);
    router.replace(`/?thread=${encodeURIComponent(tid)}`);
    router.refresh();
    return tid;
  }, [threadId, router]);

  function onNewChat() {
    router.push("/");
    router.refresh();
  }

  function onHistory() {
    router.push("/history");
  }

  // Show ONLY the hospital name once available.
  // Before the thread is titled, keep it minimal.
  const title = (threadTitle ?? "").trim() || "New chat";

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Sticky thread bar (always visible under MainHeader) */}
      <div className="sticky top-0 z-40 mb-3">
        <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-semibold text-slate-800">
              {title}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onHistory}
                className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50"
                style={{ borderColor: brandColor, color: brandColor }}
              >
                Chat history
              </button>

              <button
                type="button"
                onClick={onNewChat}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:opacity-80"
                style={{ background: brandColor }}
              >
                New chat
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat card */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {/* Transcript */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {messages.length ? (
            <div className="space-y-3">
              {messages.map((m) => {
                const isUser = m.role === "user";
                return (
                  <div
                    key={m.id}
                    className={`group flex ${
                      isUser ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div className="flex flex-col">
                      <div
                        className="max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed"
                        style={{
                          background: isUser ? brandColor : "#f1f5f9",
                          color: isUser ? "white" : "#0f172a",
                          borderTopRightRadius: isUser ? 8 : 18,
                          borderTopLeftRadius: isUser ? 18 : 8,
                        }}
                      >
                        {m.content}
                      </div>

                      {/* Hover timestamp */}
                      <div
                        className={`mt-1 text-[11px] text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 ${
                          isUser ? "text-right" : "text-left"
                        }`}
                        title={m.created_at}
                      >
                        {formatTimestamp(m.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Start the conversation…</div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 bg-white p-4">
          <ChatComposer threadId={threadId} ensureThreadId={ensureThreadId} />
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;

  const day = d.toLocaleDateString([], { weekday: "short" });
  return `${day} ${time}`;
}
