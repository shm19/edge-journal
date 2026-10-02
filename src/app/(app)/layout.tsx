import { Sidebar } from "@/components/nav";
import { requireAuth } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return (
    <div className="flex min-h-screen min-w-[1024px]">
      <Sidebar logout={logout} />
      <main className="min-w-0 flex-1 px-8 pt-7 pb-10">
        <div className="mx-auto max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  );
}
