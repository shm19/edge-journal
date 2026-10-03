import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/db";
import { isAuthenticated } from "@/lib/auth";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  if (!(await isAuthenticated())) return new Response("unauthorized", { status: 401 });
  const { name } = await ctx.params;
  if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/.test(name)) return new Response("not found", { status: 404 });
  try {
    const data = await fs.readFile(path.join(UPLOAD_DIR, name));
    const ext = name.split(".").pop()!.toLowerCase();
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": MIME[ext],
        // Names are random and never reused, so immutable is safe; "private" keeps shared caches out.
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-disposition": "inline",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
