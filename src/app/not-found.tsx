import { LinkButton } from "@/components/ui";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-center">
        <h1 className="text-base font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">That page doesn&apos;t exist, or the idea or setup was deleted.</p>
        <div className="mt-5 flex justify-center">
          <LinkButton variant="primary" href="/">
            Back to dashboard
          </LinkButton>
        </div>
      </div>
    </main>
  );
}
