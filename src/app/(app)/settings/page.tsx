import { Download, LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
import { count } from "drizzle-orm";
import { GeneralSettings, MistakeTypeManager, ScenarioTypeManager, TagManager } from "@/components/settings-forms";
import { buttonClass, Card, CardHeader, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { ideaMistakes, ideaTags, scenarios } from "@/db/schema";
import { listMistakeTypes, listScenarioTypes, listTags } from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const settings = getSettings();
  const tagUsage = Object.fromEntries(
    db
      .select({ id: ideaTags.tagId, n: count() })
      .from(ideaTags)
      .groupBy(ideaTags.tagId)
      .all()
      .map((r) => [r.id, r.n]),
  );
  const typeUsage = Object.fromEntries(
    db
      .select({ id: scenarios.scenarioTypeId, n: count() })
      .from(scenarios)
      .groupBy(scenarios.scenarioTypeId)
      .all()
      .filter((r) => r.id != null)
      .map((r) => [r.id!, r.n]),
  );

  const mistakeUsage = Object.fromEntries(
    db
      .select({ id: ideaMistakes.mistakeTypeId, n: count() })
      .from(ideaMistakes)
      .groupBy(ideaMistakes.mistakeTypeId)
      .all()
      .map((r) => [r.id, r.n]),
  );

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <form action={logout}>
            <button className={buttonClass("secondary", "sm")}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </form>
        }
      />
      <div className="grid grid-cols-2 gap-5 [&>*]:min-w-0">
        <div className="min-w-0 space-y-5">
          <GeneralSettings initial={settings} />
          <Card>
            <CardHeader title="Export & backup" description="Your data is yours. Download it any time." />
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              <a href="/api/export?format=csv" className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Trades CSV
              </a>
              <a href="/api/export?format=json" className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Full JSON
              </a>
              <a href="/api/export?format=db" className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> SQLite backup
              </a>
            </div>
          </Card>
          <ScenarioTypeManager types={listScenarioTypes()} usage={typeUsage} />
          <MistakeTypeManager types={listMistakeTypes()} usage={mistakeUsage} />
        </div>
        <TagManager tags={listTags()} usage={tagUsage} />
      </div>
    </>
  );
}
