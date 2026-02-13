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
        border: "2px solid rgba(0,0,0,0.18)",
        borderTopColor: "rgba(0,0,0,0.55)",
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

      const raw = await resp.text();
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

  const canSend = !loading && Boolean(text.trim());

  return (
    <div className="w-full">
      {/* Subtle inline status (optional, but looks pro) */}
      {loading && (
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-600">
          <Spinner />
          <span style={{ color: BRAND, fontWeight: 700 }}>
            Working on it…
          </span>
        </div>
      )}

      <form
        onSubmit={onSend}
        className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          disabled={loading}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:bg-white focus:ring-2"
          style={{
            // Tailwind ring color helper (keeps brand)
            boxShadow: "none",
          }}
          onFocus={(e) => {
            // lightweight brand “ring” without needing tailwind config
            e.currentTarget.style.boxShadow = `0 0 0 3px ${brandAlpha(
              BRAND,
              0.18
            )}`;
            e.currentTarget.style.borderColor = BRAND;
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.borderColor = "#e2e8f0"; // slate-200
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
          disabled={!canSend}
          className="rounded-xl px-4 py-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: BRAND,
            color: "white",
            border: `1px solid ${BRAND}`,
          }}
          title={canSend ? "Send message" : "Type a message to send"}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span>Sending</span>
              <Spinner />
            </span>
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

/**
 * Helper to convert hex color -> rgba with alpha.
 * Keeps the component self-contained (no tailwind config needed).
 */
function brandAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
