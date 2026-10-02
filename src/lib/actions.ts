"use server";

import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, UPLOAD_DIR } from "@/db";
import { attachments, ideaMistakes, ideas, ideaTags, mistakeTypes, scenarios, scenarioTypes, settings, setups, tags } from "@/db/schema";
import { requireAuth } from "./auth";
import {
  firstError,
  ideaSchema,
  scenarioTypeSchema,
  settingsSchema,
  setupSchema,
  tagSchema,
} from "./validation";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function removeUpload(fileName: string) {
  const full = path.join(UPLOAD_DIR, path.basename(fileName));
  fs.promises.unlink(full).catch(() => {});
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

// ---------- Ideas ----------

export async function saveIdea(payload: unknown): Promise<ActionResult<{ id: number }>> {
  await requireAuth();
  const parsed = ideaSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, tagIds, scenarios: scen, attachments: atts, mistakes, ...fields } = parsed.data;
  const now = new Date().toISOString();
  // References may have been deleted in another tab — drop them instead of failing on a foreign key.
  if (fields.setupId != null && !db.select({ id: setups.id }).from(setups).where(eq(setups.id, fields.setupId)).get()) {
    fields.setupId = null;
  }
  const typeIds = new Set(db.select({ id: scenarioTypes.id }).from(scenarioTypes).all().map((t) => t.id));
  for (const s of scen) if (s.scenarioTypeId != null && !typeIds.has(s.scenarioTypeId)) s.scenarioTypeId = null;
  const mistakeTypeIds = new Set(db.select({ id: mistakeTypes.id }).from(mistakeTypes).all().map((t) => t.id));
  const validMistakes = mistakes.filter((m) => mistakeTypeIds.has(m.mistakeTypeId));
  if (fields.status !== "forward_test") fields.outcome = null;
  const removedFiles: string[] = [];

  try {
    const ideaId = db.transaction((tx) => {
      let ideaId: number;
      if (id) {
        const existing = tx.select({ id: ideas.id }).from(ideas).where(eq(ideas.id, id)).get();
        if (!existing) throw new Error("Idea not found");
        tx.update(ideas)
          .set({ ...fields, updatedAt: now })
          .where(eq(ideas.id, id))
          .run();
        ideaId = id;
      } else {
        ideaId = tx.insert(ideas).values(fields).returning({ id: ideas.id }).get().id;
      }

      // Scenarios: delete the ones removed in the editor, upsert the rest.
      const keepIds = scen.map((s) => s.id).filter((x): x is number => x != null);
      tx.delete(scenarios)
        .where(keepIds.length ? and(eq(scenarios.ideaId, ideaId), notInArray(scenarios.id, keepIds)) : eq(scenarios.ideaId, ideaId))
        .run();
      const scenarioIds: number[] = [];
      for (const { id: sid, ...s } of scen) {
        if (sid) {
          tx.update(scenarios)
            .set(s)
            .where(and(eq(scenarios.id, sid), eq(scenarios.ideaId, ideaId)))
            .run();
          scenarioIds.push(sid);
        } else {
          scenarioIds.push(tx.insert(scenarios).values({ ...s, ideaId }).returning({ id: scenarios.id }).get().id);
        }
      }

      // Mistakes: replace; link to the saved alternative by position.
      tx.delete(ideaMistakes).where(eq(ideaMistakes.ideaId, ideaId)).run();
      if (validMistakes.length) {
        tx.insert(ideaMistakes)
          .values(
            validMistakes.map((m) => ({
              ideaId,
              mistakeTypeId: m.mistakeTypeId,
              note: m.note,
              costR: m.costR,
              scenarioId: m.scenarioIndex != null ? (scenarioIds[m.scenarioIndex] ?? null) : null,
            })),
          )
          .run();
      }

      // Tags: replace.
      tx.delete(ideaTags).where(eq(ideaTags.ideaId, ideaId)).run();
      const uniqueTags = [...new Set(tagIds)];
      if (uniqueTags.length) {
        const valid = tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, uniqueTags)).all();
        if (valid.length) tx.insert(ideaTags).values(valid.map((t) => ({ ideaId, tagId: t.id }))).run();
      }

      // Attachments: drop removed ones (and their files), upsert the rest.
      const existingAtts = tx.select().from(attachments).where(eq(attachments.ideaId, ideaId)).all();
      const keepAtt = new Set(atts.map((a) => a.id).filter(Boolean));
      for (const a of existingAtts) {
        if (!keepAtt.has(a.id)) {
          tx.delete(attachments).where(eq(attachments.id, a.id)).run();
          removedFiles.push(a.filePath);
        }
      }
      for (const { id: aid, ...a } of atts) {
        if (aid) {
          tx.update(attachments)
            .set({ caption: a.caption, kind: a.kind })
            .where(and(eq(attachments.id, aid), eq(attachments.ideaId, ideaId)))
            .run();
        } else {
          tx.insert(attachments)
            .values({ ...a, ideaId })
            .run();
        }
      }
      return ideaId;
    });

    removedFiles.forEach(removeUpload);
    revalidateAll();
    return { ok: true, data: { id: ideaId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save" };
  }
}

export async function deleteIdea(id: number): Promise<ActionResult> {
  await requireAuth();
  const files = db.select({ f: attachments.filePath }).from(attachments).where(eq(attachments.ideaId, id)).all();
  db.delete(ideas).where(eq(ideas.id, id)).run();
  files.forEach((f) => removeUpload(f.f));
  revalidateAll();
  return { ok: true };
}

export async function duplicateIdea(id: number): Promise<ActionResult<{ id: number }>> {
  await requireAuth();
  const src = db.select().from(ideas).where(eq(ideas.id, id)).get();
  if (!src) return { ok: false, error: "Idea not found" };
  const newId = db.transaction((tx) => {
    const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = src;
    const nid = tx
      .insert(ideas)
      .values({ ...rest, openedAt: new Date().toISOString(), closedAt: null, review: "", followedPlan: null, outcome: null })
      .returning({ id: ideas.id })
      .get().id;
    const t = tx.select().from(ideaTags).where(eq(ideaTags.ideaId, id)).all();
    if (t.length) tx.insert(ideaTags).values(t.map((x) => ({ ideaId: nid, tagId: x.tagId }))).run();
    const sc = tx.select().from(scenarios).where(eq(scenarios.ideaId, id)).all();
    for (const { id: _sid, ...s } of sc) {
      tx.insert(scenarios)
        .values({ ...s, ideaId: nid, exitPrice: null, exitReason: null })
        .run();
    }
    return nid;
  });
  revalidateAll();
  return { ok: true, data: { id: newId } };
}

// ---------- Setups ----------

export async function saveSetup(payload: unknown): Promise<ActionResult<{ id: number }>> {
  await requireAuth();
  const parsed = setupSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...fields } = parsed.data;
  try {
    let sid = id;
    if (id) {
      if (!db.select({ id: setups.id }).from(setups).where(eq(setups.id, id)).get()) return { ok: false, error: "This setup was deleted" };
      db.update(setups)
        .set({ ...fields, updatedAt: new Date().toISOString() })
        .where(eq(setups.id, id))
        .run();
    } else {
      sid = db.insert(setups).values(fields).returning({ id: setups.id }).get().id;
    }
    revalidateAll();
    return { ok: true, data: { id: sid! } };
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("UNIQUE") ? "A setup with that name already exists" : "Failed to save setup";
    return { ok: false, error: msg };
  }
}

export async function deleteSetup(id: number): Promise<ActionResult> {
  await requireAuth();
  db.delete(setups).where(eq(setups.id, id)).run();
  revalidateAll();
  return { ok: true };
}

// ---------- Tags & scenario types ----------

export async function saveTag(payload: unknown): Promise<ActionResult> {
  await requireAuth();
  const parsed = tagSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...fields } = parsed.data;
  const clash = db
    .select({ id: tags.id, name: tags.name, group: tags.group })
    .from(tags)
    .all()
    .find((t) => t.id !== id && t.name.toLowerCase() === fields.name.toLowerCase() && t.group.toLowerCase() === fields.group.toLowerCase());
  if (clash) return { ok: false, error: `“${fields.name}” already exists in ${clash.group}` };
  if (id) {
    if (!db.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get()) return { ok: false, error: "This tag was deleted" };
    db.update(tags).set(fields).where(eq(tags.id, id)).run();
  } else db.insert(tags).values(fields).run();
  revalidateAll();
  return { ok: true };
}

export async function deleteTag(id: number): Promise<ActionResult> {
  await requireAuth();
  db.delete(tags).where(eq(tags.id, id)).run();
  revalidateAll();
  return { ok: true };
}

export async function saveScenarioType(payload: unknown): Promise<ActionResult<{ id: number }>> {
  await requireAuth();
  const parsed = scenarioTypeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...fields } = parsed.data;
  try {
    let tid = id;
    if (id) db.update(scenarioTypes).set(fields).where(eq(scenarioTypes.id, id)).run();
    else tid = db.insert(scenarioTypes).values(fields).returning({ id: scenarioTypes.id }).get().id;
    revalidateAll();
    return { ok: true, data: { id: tid! } };
  } catch {
    return { ok: false, error: "An alternative type with that name already exists" };
  }
}

export async function saveMistakeType(payload: unknown): Promise<ActionResult<{ id: number }>> {
  await requireAuth();
  const parsed = scenarioTypeSchema.safeParse(payload); // same shape: name + description
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...fields } = parsed.data;
  try {
    let tid = id;
    if (id) db.update(mistakeTypes).set(fields).where(eq(mistakeTypes.id, id)).run();
    else tid = db.insert(mistakeTypes).values(fields).returning({ id: mistakeTypes.id }).get().id;
    revalidateAll();
    return { ok: true, data: { id: tid! } };
  } catch {
    return { ok: false, error: "A mistake type with that name already exists" };
  }
}

export async function deleteMistakeType(id: number): Promise<ActionResult> {
  await requireAuth();
  db.delete(mistakeTypes).where(eq(mistakeTypes.id, id)).run(); // its mistake entries cascade
  revalidateAll();
  return { ok: true };
}

export async function deleteScenarioType(id: number): Promise<ActionResult> {
  await requireAuth();
  // Alternatives of a deleted type would become indistinguishable from the primary; remove them.
  db.transaction((tx) => {
    tx.delete(scenarios)
      .where(and(eq(scenarios.scenarioTypeId, id), eq(scenarios.isPrimary, false)))
      .run();
    tx.delete(scenarioTypes).where(eq(scenarioTypes.id, id)).run();
  });
  revalidateAll();
  return { ok: true };
}

// ---------- Settings ----------

export async function saveSettings(payload: unknown): Promise<ActionResult> {
  await requireAuth();
  const parsed = settingsSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const s = parsed.data;
  const rows = [
    { key: "beThresholdR", value: String(s.beThresholdR) },
    { key: "minRR", value: String(s.minRR) },
    { key: "defaultRiskPct", value: String(s.defaultRiskPct) },
    { key: "symbols", value: [...new Set(s.symbols.map((x) => x.toUpperCase()))].join(",") },
  ];
  db.transaction((tx) => {
    for (const r of rows) {
      tx.insert(settings).values(r).onConflictDoUpdate({ target: settings.key, set: { value: r.value } }).run();
    }
  });
  revalidateAll();
  return { ok: true };
}

export async function renameTagGroup(from: string, to: string): Promise<ActionResult> {
  await requireAuth();
  const name = to.trim();
  if (!name || name.length > 40) return { ok: false, error: "Group name must be 1–40 characters" };
  const all = db.select().from(tags).all();
  const moving = all.filter((t) => t.group === from);
  const target = all.filter((t) => t.group.toLowerCase() === name.toLowerCase() && t.group !== from);
  // Merging into an existing group: refuse if it would create duplicate tag names.
  const clash = moving.find((m) => target.some((t) => t.name.toLowerCase() === m.name.toLowerCase()));
  if (clash) return { ok: false, error: `“${clash.name}” already exists in ${target[0].group}` };
  const finalName = target[0]?.group ?? name;
  db.update(tags).set({ group: finalName }).where(eq(tags.group, from)).run();
  revalidateAll();
  return { ok: true };
}

export async function deleteTagGroup(group: string): Promise<ActionResult> {
  await requireAuth();
  db.delete(tags).where(eq(tags.group, group)).run(); // idea_tags rows cascade
  revalidateAll();
  return { ok: true };
}
