import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORT } from "./env";

export default function globalTeardown() {
  fs.rmSync(path.join(os.tmpdir(), `edge-journal-e2e-${PORT}`), { recursive: true, force: true });
}
