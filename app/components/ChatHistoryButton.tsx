"use client";

import { useRouter } from "next/navigation";

export default function ChatHistoryButton({
  brandColor,
}: {
  brandColor: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:opacity-80"
      style={{ background: brandColor }}
      onClick={() => router.push("/history")}
    >
      Chat history
    </button>
  );
}
