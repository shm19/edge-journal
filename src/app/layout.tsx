import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Edge Journal", template: "%s · Edge Journal" },
  description: "Personal crypto trading journal — setups, scenarios, R.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#09090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
