"use client";

import { useMemo, useState } from "react";
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
  threadId: string;
  initialMessages: Msg[];
  brandColor: string;
}) {
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);

  // We render from the server-provided messages.
  // After clearing, we refresh the route to re-fetch messages (empty).
  const messages = useMemo(() => initialMessages ?? [], [initialMessages]);

  async function clearChat() {
    const ok = confirm("Clear this chat? This cannot be undone.");
    if (!ok) return;

    try {
      setIsClearing(true);

      const res = await fetch("/api/chat/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: threadId }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Clear failed (${res.status})`);
      }

      // Force server component to refetch messages
      router.refresh();
    } catch (e: any) {
      alert(e?.message || "Failed to clear chat.");
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <>
      {/* Header row with Clear button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 900, color: brandColor }}>Chat</div>

        <button
          type="button"
          onClick={clearChat}
          disabled={isClearing || messages.length === 0}
          style={{
            border: "1px solid #e7e7e7",
            background: "white",
            borderRadius: 12,
            padding: "8px 10px",
            fontWeight: 900,
            fontSize: 12,
            cursor:
              isClearing || messages.length === 0 ? "not-allowed" : "pointer",
            opacity: isClearing || messages.length === 0 ? 0.55 : 1,
          }}
          title="Clear this chat"
        >
          {isClearing ? "Clearing…" : "Clear chat"}
        </button>
      </div>

      {/* Chat transcript */}
      <div
        style={{
          border: "1px solid #e7e7e7",
          borderRadius: 16,
          padding: 16,
          minHeight: 300,
          marginBottom: 12,
        }}
      >
        {messages.length ? (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                marginBottom: 10,
                textAlign: m.role === "user" ? "right" : "left",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  background: m.role === "user" ? brandColor : "#f3f3f3",
                  color: m.role === "user" ? "white" : "#111",
                  padding: "8px 12px",
                  borderRadius: 12,
                  maxWidth: "80%",
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content}
              </div>
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.6 }}>Start the conversation…</div>
        )}
      </div>

      {/* Composer */}
      <ChatComposer threadId={threadId} />
    </>
  );
}
