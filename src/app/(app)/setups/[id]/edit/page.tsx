import { notFound } from "next/navigation";
import { SetupEditor } from "@/components/setup-editor";
import { PageHeader } from "@/components/ui";
import { getSetup, setupIdeaCount } from "@/lib/queries";

export const metadata = { title: "Edit setup" };

export default async function EditSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const setup = getSetup(Number(id));
  if (!setup) notFound();
  const tradeCount = setupIdeaCount(setup.id);
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
