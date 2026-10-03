import { Download } from "lucide-react";
import { GeneralSettings, MistakeTypeManager, ScenarioTypeManager, TagManager } from "@/components/settings-forms";
import { buttonClass, Card, CardHeader, PageHeader } from "@/components/ui";
import { listMistakeTypes, listScenarioTypes, listTags, usageCounts } from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const settings = getSettings();
  const usage = usageCounts();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-2 gap-5 [&>*]:min-w-0">
        <div className="min-w-0 space-y-5">
          <GeneralSettings initial={settings} />
          <Card>
            <CardHeader title="Export & backup" description="Your data is yours. Download it any time." />
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              <a href="/api/export?format=csv" className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Trades CSV
              </a>
              <a href="/api/export?format=json" className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Full JSON
              </a>
              <a href="/api/export?format=db" className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Database only (no screenshots)
              </a>
            </div>
            <p className="px-4 pb-4 text-xs text-muted">
              For a full backup including screenshots, run <code className="font-mono">scripts/backup.sh</code> on the server (see the README).
            </p>
          </Card>
          <ScenarioTypeManager types={listScenarioTypes()} usage={usage.scenarioType} />
          <MistakeTypeManager types={listMistakeTypes()} usage={usage.mistakeType} />
        </div>
        <TagManager tags={listTags()} usage={usage.tag} />
      </div>
    </>
  );
}
