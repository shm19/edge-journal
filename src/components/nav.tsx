"use client";

import { BarChart3, BookOpen, LayoutDashboard, Layers, LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ideas", label: "Journal", icon: BookOpen },
  { href: "/setups", label: "Setups", icon: Layers },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (pathname === "/ideas/new") return false; // the + button owns "new"
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ logout }: { logout: () => Promise<void> }) {
  const pathname = usePathname();
  const router = useRouter();

  // "n" anywhere (outside inputs, never inside an editor) → new idea.
  const inEditor = /^\/(ideas|setups)\/(new|\d+\/edit)$/.test(pathname);
  useEffect(() => {
    if (inEditor) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName))) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        router.push("/ideas/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, inEditor]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel/60 px-3 py-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-strong/20 ring-1 ring-accent/40">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 17l5-5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-sm font-semibold">Edge Journal</span>
        </Link>
        <Link
          href="/ideas/new"
          className="mb-4 flex h-9 items-center justify-between rounded-lg bg-accent-strong px-3 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> New idea
          </span>
          <kbd className="rounded bg-white/15 px-1.5 text-[10px]">N</kbd>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
                isActive(pathname, href) ? "bg-panel-3 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <form action={logout} className="mt-auto">
          <button className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-faint hover:bg-panel-2 hover:text-fg">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {ITEMS.slice(0, 2).map(({ href, label, icon: Icon }) => (
          <MobileItem key={href} href={href} label={label} active={isActive(pathname, href)} Icon={Icon} />
        ))}
        <Link href="/ideas/new" className="flex flex-1 flex-col items-center justify-center py-2" aria-label="New idea">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-strong text-white">
            <Plus className="h-5 w-5" />
          </span>
        </Link>
        {ITEMS.slice(2).map(({ href, label, icon: Icon }) => (
          <MobileItem key={href} href={href} label={label} active={isActive(pathname, href)} Icon={Icon} />
        ))}
      </nav>
    </>
  );
}

function MobileItem({
  href,
  label,
  active,
  Icon,
}: {
  href: string;
  label: string;
  active: boolean;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]", active ? "text-fg" : "text-faint")}>
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}
