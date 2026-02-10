import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Oliver 2.0",
  description: "Chat-first sales copilot",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#49257a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
<body className="min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto">

        {/* App root wrapper: allows pages to use full height reliably */}
        <div id="app-root" className="min-h-[100dvh] w-full">
          {children}
        </div>
      </body>
    </html>
  );
}
