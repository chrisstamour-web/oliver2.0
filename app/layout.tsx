import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Oliver 2.0",
  description: "Chat-first sales copilot",
  icons: {
    icon: "/logo.png",  // <-- change if your filename differs
    apple: "/logo.png", // <-- change if your filename differs
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
      <body>{children}</body>
    </html>
  );
}
