import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { SetupEditor } from "@/components/setup-editor";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { ideas, setups } from "@/db/schema";

export const metadata = { title: "Edit setup" };

export default async function EditSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const setup = db.select().from(setups).where(eq(setups.id, Number(id))).get();
  if (!setup) notFound();
  const tradeCount = db.select({ id: ideas.id }).from(ideas).where(eq(ideas.setupId, setup.id)).all().length;
  return (
    <>
      <PageHeader title={`Edit · ${setup.name}`} />
      <SetupEditor
        tradeCount={tradeCount}
        initial={{
          id: setup.id,
          name: setup.name,
          description: setup.description,
          rules: setup.rules,
          checklist: setup.checklist,
          status: setup.status,
          defaultTimeframe: setup.defaultTimeframe ?? "",
          color: setup.color,
        }}
      />
    </>
  );
}
