"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/actions/sendMessage";

const BRAND = "#49257a";

export default function ChatComposer({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      await sendMessage(threadId, trimmed);
      setText("");
      router.refresh(); // reload messages server-side
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
