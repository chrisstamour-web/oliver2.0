"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/actions/sendMessage";

const BRAND = "#49257a";

function Spinner() {
  return (
    <span
      aria-label="Loading"
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid rgba(0,0,0,0.2)",
        borderTopColor: "rgba(0,0,0,0.7)",
        display: "inline-block",
        animation: "spin 0.9s linear infinite",
        flex: "0 0 auto",
      }}
    />
  );
}

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

      const raw = await resp.text(); // read once
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = { _nonJson: raw };
      }

      if (!resp.ok) {
        const errMsg =
          (data && (data.error || data.message)) ||
          (typeof raw === "string" ? raw : "") ||
          `HTTP ${resp.status}`;
        throw new Error(
          `respond failed (${resp.status}): ${String(errMsg).slice(0, 300)}`
        );
      }

      console.log("QB_TRACE respond", {
        route: data?.route,
        confidence: data?.confidence,
        usedKb: data?.usedKb,
        usedResearch: data?.usedResearch,
        ok: data?.ok,
      });

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
    <div style={{ display: "grid", gap: 10 }}>
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid #e7e7e7",
            borderRadius: 14,
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          <Spinner />
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.25,
              fontWeight: 800,
              color: BRAND,
              fontFamily:
                "'Montserrat', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            }}
          >
            Great things are happening…
          </div>
        </div>
      )}

      <form
        onSubmit={onSend}
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          border: "1px solid #e7e7e7",
          borderRadius: 16,
          padding: 10,
          background: "var(--background)",
          color: "var(--foreground)",
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
            background: "var(--background)",
            color: "var(--foreground)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !text.trim()}
          style={{
            background: BRAND,
            color: "white",
            border: `1px solid ${BRAND}`,
            borderRadius: 12,
            padding: "10px 14px",
            fontWeight: 800,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {loading ? (
            <>
              <span>Working…</span>
              <Spinner />
            </>
          ) : (
            "Send"
          )}
        </button>
      </form>

      <style jsx global>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
