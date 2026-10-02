import { SetupEditor } from "@/components/setup-editor";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New setup" };

export default function NewSetupPage() {
  return (
    <>
      <PageHeader title="New setup" description="Start in Testing — promote it to Live once the numbers earn it." />
      <SetupEditor
        initial={{ name: "", description: "", rules: "", checklist: [], status: "testing", defaultTimeframe: "", color: "#6366f1" }}
      />
    </>
  );
}
