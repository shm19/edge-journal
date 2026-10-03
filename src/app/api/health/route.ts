import fs from "node:fs";
import { DATA_DIR, UPLOAD_DIR, sqlite } from "@/db";

export const dynamic = "force-dynamic";

// Public (see proxy.ts), so the body never says what failed or where; the cause goes to the server log.
export function GET() {
  try {
    sqlite.prepare("select 1").get(); // opens (and migrates) the DB on first use
    fs.accessSync(DATA_DIR, fs.constants.W_OK); // SQLite needs it for -wal / -shm
    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("health check failed:", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
