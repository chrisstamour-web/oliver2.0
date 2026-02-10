"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/actions/sendMessage";

const BRAND = "#49257a";

export default function ChatComposer({
  threadId,
  ensureThreadId,
}: {
  threadId: string | null;
  ensureThreadId: () => Promise<string>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    try {
      // 1) Guarantee a thread exists
      const tid = threadId ?? (await ensureThreadId());

      // 2) Save the user message (server action)
      const res = await sendMessage({
        threadId: tid,
        content: trimmed,
      });

      setText("");

      // 3) Stabilize URL on the thread
      const nextThreadId = res?.threadId ?? tid;
      router.replace(`/?thread=${encodeURIComponent(nextThreadId)}`);

      // 4) Generate + save assistant reply (API route)
      const resp = await fetch("/api/chat/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: nextThreadId }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`respond failed (${resp.status}): ${t.slice(0, 200)}`);
      }

      // 5) Reload transcript from server
      router.refresh();
    } catch (err: any) {
      console.error("send failed:", err);
      const msg =
        err?.message ||
        (typeof err === "string" ? err : null) ||
        JSON.stringify(err, null, 2);
      alert(msg ?? "Send failed (see console)");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSend}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        border: "1px solid #e7e7e7",
        borderRadius: 16,
        padding: 10,
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message…"
        disabled={loading}
        style={{
          flex: 1,
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: "10px 12px",
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={loading}
        style={{
          background: BRAND,
          color: "white",
          border: `1px solid ${BRAND}`,
          borderRadius: 12,
          padding: "10px 14px",
          fontWeight: 800,
          cursor: "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "..." : "Send"}
      </button>
    </form>
  );
}
