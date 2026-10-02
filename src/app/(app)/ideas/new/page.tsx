import { IdeaEditor } from "@/components/idea-editor";
import { PageHeader } from "@/components/ui";
import { newEditorIdea } from "@/lib/editor-shape";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { IDEA_STATUSES, ideas } from "@/db/schema";
import { listMistakeTypes, listScenarioTypes, listSetups, listTags } from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "New idea" };

export default async function NewIdeaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const settings = getSettings();
  const setups = listSetups();
  const setupId = sp.setup ? Number(sp.setup) : null;
  const setup = setups.find((s) => s.id === setupId);
  const status = IDEA_STATUSES.includes(sp.status as never) ? sp.status : undefined;

  return (
    <>
      <PageHeader title="New idea" description="Log a trade you took, one you skipped or missed, or a forward test." />
      <IdeaEditor
        initial={newEditorIdea({
          setupId: setup?.id ?? null,
          status,
          symbol: sp.symbol?.toUpperCase() ?? lastSymbol(),
          timeframe: setup?.defaultTimeframe,
          riskPct: settings.defaultRiskPct,
        })}
        setups={setups}
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

/** Pre-fill the coin with the last one you logged. */
function lastSymbol(): string | undefined {
  return db.select({ s: ideas.symbol }).from(ideas).orderBy(desc(ideas.id)).limit(1).get()?.s;
}
