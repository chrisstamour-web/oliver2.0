"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type ThreadItem = {
  id: string;
  title: string;
  updatedLabel: string;
};

export default function HistoryClient({
  brandColor,
  threads,
}: {
  brandColor: string;
  threads: ThreadItem[];
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return threads;

    return threads.filter((t) => {
      const hay = `${t.title} ${t.updatedLabel}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [q, threads]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold" style={{ color: brandColor }}>
          Chat history
        </h1>

        <Link
          href="/"
          className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Back
        </Link>
      </div>

      {/* Search */}
      <div className="mt-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search threads…"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:bg-white"
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = `0 0 0 3px ${brandAlpha(
              brandColor,
              0.18
            )}`;
            e.currentTarget.style.borderColor = brandColor;
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.borderColor = "#e2e8f0";
          }}
        />
      </div>

      <div className="mt-6 space-y-2">
        {filtered.length ? (
          filtered.map((t) => (
            <Link
              key={t.id}
              href={`/?thread=${encodeURIComponent(t.id)}`}
              className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50"
            >
              <div className="text-sm font-semibold text-slate-900">
                {t.title}
              </div>
              <div className="mt-1 text-xs text-slate-500">{t.updatedLabel}</div>
            </Link>
          ))
        ) : (
          <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
            No matches.
          </div>
        )}
      </div>
    </div>
  );
}

function brandAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
