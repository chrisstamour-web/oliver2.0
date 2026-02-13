// app/(app)/layout.tsx
import "server-only";
import type { ReactNode } from "react";
import MainHeader from "@/app/components/MainHeader";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen w-full bg-slate-50">
      <div className="flex h-full flex-col">
        <MainHeader />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
