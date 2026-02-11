// app/components/MainHeader.tsx
"use client";

import Image from "next/image";
import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";

const BRAND = "#49257a";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function MainHeader(props: {
  threadId?: string | null;
  hasMessages?: boolean;
  brandColor?: string;
}) {
  const router = useRouter();

  const threadId = props.threadId ?? null;
  const hasMessages = Boolean(props.hasMessages);
  const brandColor = props.brandColor ?? BRAND;

  const canStartNew = true;


  function onNewChat() {
    router.push("/");
    router.refresh();
  }

  function onHistory() {
    router.push("/history");
  }

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Left: Brand */}
      <div className="flex items-center gap-2">
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid #eee",
            background: "#fff",
            flex: "0 0 auto",
          }}
        >
          <Image src="/logo.png" alt="Oliver" width={38} height={38} priority />
        </div>

        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontWeight: 900, color: brandColor, fontSize: 18 }}>
            Oliver
          </div>

          <div
            className={montserrat.className}
            style={{
              fontSize: 13,
              color: "#4b5563",
              marginTop: 3,
              fontWeight: 500,
            }}
          >
            your Pathova Assistant
          </div>
        </div>
      </div>

      {/* Right: Actions (ONLY here) */}
      <div className="ml-auto flex items-center gap-2">
        {/* Chat history (left of New chat) */}
        <button
          type="button"
          onClick={onHistory}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:opacity-80"
          style={{ background: brandColor }}
          title="Chat history"
        >
          Chat history
        </button>

        {/* New chat (furthest right) */}
        <button
          type="button"
          onClick={onNewChat}
          disabled={!canStartNew}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: brandColor }}
          title={canStartNew ? "Start a new chat" : "Start by sending a message"}
        >
          New chat
        </button>
      </div>
    </div>
  );
}
