import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { UPLOAD_DIR } from "@/db";
import { isAuthenticated } from "@/lib/auth";
import { sniff } from "@/lib/image-sniff";

const MAX_BYTES = 10 * 1024 * 1024;

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
