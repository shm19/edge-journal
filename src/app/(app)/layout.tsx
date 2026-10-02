import { Sidebar } from "@/components/nav";
import { requireAuth } from "@/lib/auth";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return (
    <div className="flex min-h-screen">
      <Sidebar logout={logout} />
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 md:px-8 md:pt-7 md:pb-10">
        <div className="mx-auto max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  );
}
