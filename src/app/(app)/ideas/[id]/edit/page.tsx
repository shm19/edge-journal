import { notFound } from "next/navigation";
import { IdeaEditor } from "@/components/idea-editor";
import { PageHeader } from "@/components/ui";
import { toEditorIdea } from "@/lib/editor-shape";
import { getIdea, listMistakeTypes, listScenarioTypes, listSetups, listTags } from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Edit idea" };

export default async function EditIdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idea = getIdea(Number(id));
  if (!idea) notFound();
  const settings = getSettings();
  return (
    <>
      <PageHeader title={`Edit · ${idea.symbol} ${idea.direction}`} />
      <IdeaEditor
        initial={toEditorIdea(idea)}
        setups={listSetups()}
        tags={listTags()}
        scenarioTypes={listScenarioTypes()}
        mistakeTypes={listMistakeTypes()}
        symbols={settings.symbols}
        minRR={settings.minRR}
        beThreshold={settings.beThresholdR}
       
      />
    </>
  );
}
