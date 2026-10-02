import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { UPLOAD_DIR } from "@/db";
import { isAuthenticated } from "@/lib/auth";

const MAX_BYTES = 10 * 1024 * 1024;

/** Detect the real image type from magic bytes (never trust the client's MIME type). */
function sniff(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "gif";
  return null;
}

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return err("unauthorized", 401);
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES + 64 * 1024) return err("Image is larger than 10 MB", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("Couldn't read the upload", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return err("No file", 400);
  if (file.size > MAX_BYTES) return err("Image is larger than 10 MB", 413);

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniff(buf);
  if (!ext) return err("Only PNG, JPG, WEBP or GIF images", 415);

  const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return NextResponse.json({ fileName: name });
}
