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
  initialMessages,
  brandColor,
}: {
  threadId: string | null;
  initialMessages: Msg[];
  brandColor: string;
}) {
  const router = useRouter();

  const messages = useMemo(() => initialMessages ?? [], [initialMessages]);

  function newChat() {
    router.push("/");
    router.refresh();
  }

  // Creates a thread if missing, updates URL, returns the thread id
  const ensureThreadId = useCallback(async () => {
    if (threadId) return threadId;

    const res = await fetch("/api/chat/create-thread", { method: "POST" });

    // If your backend redirects (307), fetch will follow and you may get HTML.
    // This guard makes the error visible instead of silent.
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

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Top-right actions only */}
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={newChat}
          disabled={!threadId}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: brandColor }}
          title={threadId ? "Start a new chat" : "You’re already in a new chat"}
        >
          New chat
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border bg-white p-4">
        {messages.length ? (
          <div className="space-y-3">
            {messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm"
                    style={{
                      background: isUser ? brandColor : "#f4f4f5",
                      color: isUser ? "white" : "#111",
                      borderTopRightRadius: isUser ? 6 : 16,
                      borderTopLeftRadius: isUser ? 16 : 6,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">Start the conversation…</div>
        )}
      </div>

      {/* Composer pinned */}
      <div className="mt-3 flex-shrink-0">
        <ChatComposer threadId={threadId} ensureThreadId={ensureThreadId} />
      </div>
    </div>
  );
}
