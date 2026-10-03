"use client";
import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";

// Replaces the root layout, so it brings its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">
        <ErrorScreen digest={error.digest} reset={reset} />
      </body>
    </html>
  );
}
