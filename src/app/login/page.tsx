import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <div>
            <p className="text-base font-semibold">Edge Journal</p>
            <p className="text-xs text-muted">Find what works. Do more of it.</p>
          </div>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}

function Logo() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-strong/20 ring-1 ring-accent/40">
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 17l5-5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
