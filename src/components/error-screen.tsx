import { Button, LinkButton } from "@/components/ui";

/** Full-page, stack-free failure screen shared by app/error.tsx and app/global-error.tsx. */
export function ErrorScreen({ digest, reset }: { digest?: string; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-center">
        <h1 className="text-base font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          The page could not be loaded. Your data is not affected. If this keeps happening, check the server log
          (<code className="font-mono text-xs">docker compose logs journal</code>).
        </p>
        {digest ? <p className="mt-3 font-mono text-xs text-faint">Error ID: {digest}</p> : null}
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          {/* Plain link on purpose: a full reload clears a broken client state. */}
          <LinkButton href="/" prefetch={false}>
            Dashboard
          </LinkButton>
        </div>
      </div>
    </main>
  );
}
