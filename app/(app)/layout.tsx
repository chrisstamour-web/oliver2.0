import MainHeader from "@/app/components/MainHeader";
import ChatHistoryButton from "@/app/components/ChatHistoryButton";

const BRAND = "#49257a";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] w-full bg-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-3 sm:px-4">
        <div className="sticky top-0 z-50 bg-white/80 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <MainHeader />
            <ChatHistoryButton brandColor={BRAND} />
          </div>
        </div>

        <main className="flex flex-1 min-h-0 flex-col overflow-hidden pb-3">
          {children}
        </main>
      </div>
    </div>
  );
}
