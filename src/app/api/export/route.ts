import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, sqlite } from "@/db";
import { attachments, ideaMistakes, ideas, ideaTags, mistakeTypes, scenarios, scenarioTypes, settings, setups, tags } from "@/db/schema";
import { isAuthenticated } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { loadIdeas } from "@/lib/queries";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return new Response("unauthorized", { status: 401 });
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

  if (format === "db") {
    // Stage in a private (0700) temp dir with a 0600 file, never a predictable name in the shared tmpdir.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-backup-"));
    const tmp = path.join(dir, "journal.db");
    let data: Buffer;
    try {
      await sqlite.backup(tmp);
      await fs.chmod(tmp, 0o600);
      data = await fs.readFile(tmp);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return new Response(new Uint8Array(data), {
      headers: {
        ...safe,
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="edge-journal-${stamp}.db"`,
      },
    });
  }

  if (format === "csv") {
    const list = loadIdeas();
    const header = [
      "id", "status", "opened_at", "closed_at", "symbol", "direction", "setup", "timeframe", "htf_bias", "regime",
      "entry", "stop", "target", "exit", "exit_reason", "planned_rr", "r", "followed_plan", "risk_pct", "pnl_usd",
      "fees_usd", "outcome", "confidence", "checklist", "tags", "mistakes", "alternatives", "thesis", "invalidation", "skip_reason", "review",
    ];
    const rows = list.map((i) => {
      const p = i.primary;
      const alts = i.scenarios
        .filter((s) => !s.isPrimary)
        .map((s) => `${s.typeName ?? "Alt"}: ${s.entry}/${s.stop}/${s.target ?? "-"} → ${s.exitReason === "not_filled" ? "not filled" : s.r == null ? "open" : `${s.r.toFixed(2)}R`}`)
        .join("; ");
      return [
        i.id, i.status, i.openedAt, i.closedAt, i.symbol, i.direction, i.setup?.name, i.entryTimeframe, i.htfBias, i.regime,
        p?.entry, p?.stop, p?.target, p?.exitPrice, p?.exitReason, p?.rr?.toFixed(2), p?.r?.toFixed(3), i.followedPlan,
        i.riskPct, i.pnlUsd, i.feesUsd, i.outcome, i.confidence,
        (i.setup?.checklist ?? []).map((c) => `${i.checklistState[c] ? "[x]" : "[ ]"} ${c}`).join("; "),
        i.tags.map((t) => `${t.group}:${t.name}`).join("; "),
        i.mistakes.map((m) => `${m.name}${m.cost != null ? ` (${m.cost.toFixed(2)}R)` : ""}${m.note ? `: ${m.note}` : ""}`).join("; "),
        alts, i.thesis, i.invalidation, i.skipReason, i.review,
      ]
        .map(csvCell)
        .join(",");
    });
    return new Response([header.join(","), ...rows].join("\n"), {
      headers: {
        ...safe,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="edge-journal-${stamp}.csv"`,
      },
    });
  }

  const dump = {
    exportedAt: new Date().toISOString(),
    setups: db.select().from(setups).all(),
    ideas: db.select().from(ideas).all(),
    scenarios: db.select().from(scenarios).all(),
    scenarioTypes: db.select().from(scenarioTypes).all(),
    tags: db.select().from(tags).all(),
    ideaTags: db.select().from(ideaTags).all(),
    attachments: db.select().from(attachments).all(),
    mistakeTypes: db.select().from(mistakeTypes).all(),
    ideaMistakes: db.select().from(ideaMistakes).all(),
    settings: db.select().from(settings).all(),
  };
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      ...safe,
      "content-type": "application/json",
      "content-disposition": `attachment; filename="edge-journal-${stamp}.json"`,
    },
  });
}
