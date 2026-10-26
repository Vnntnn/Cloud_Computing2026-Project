import { asc, db, eq, eventCategories } from "@app/db";
import { HTTPError } from "elysia";
import { CategoryNotFound, isForeignKeyViolation, isUniqueViolation } from "../../libs/errors";
import { forgetCategoryEvents } from "../../libs/event-cache";
import type * as CategoryModel from "./model";

export class CategoryTaken extends HTTPError.id("CATEGORY_TAKEN", 409) {
  override readonly detail = "ชื่อหรือลิงก์ของหมวดหมู่นี้ถูกใช้แล้ว";
}

export class CategoryInUse extends HTTPError.id("CATEGORY_IN_USE", 409) {
  override readonly detail = "ลบไม่ได้ เพราะยังมีอีเวนต์ในหมวดหมู่นี้";
}

const toCategory = ({ id, name, nameEn, slug }: typeof eventCategories.$inferSelect): CategoryModel.Category => ({
  id,
  name,
  nameEn,
  slug,
});

// "" and whitespace mean "no English name", the same as null
const cleanEn = (value: string | null | undefined) => (value == null ? value : value.trim() || null);

export async function listCategories() {
  const rows = await db.select().from(eventCategories).orderBy(asc(eventCategories.name));
  return rows.map(toCategory);
}

export async function createCategory(input: CategoryModel.Post["Body"]) {
  try {
    const [row] = await db
      .insert(eventCategories)
      .values({ name: input.name.trim(), nameEn: cleanEn(input.nameEn) ?? null, slug: input.slug })
      .returning();
    return toCategory(row!);
  } catch (error) {
    if (isUniqueViolation(error)) return new CategoryTaken();
    throw error;
  }
}

export async function updateCategory(id: string, input: CategoryModel.ByIdPatch["Body"]) {
  if (Object.keys(input).length === 0) {
    const [row] = await db.select().from(eventCategories).where(eq(eventCategories.id, id));
    return row ? toCategory(row) : new CategoryNotFound();
  }
  try {
    const [row] = await db
      .update(eventCategories)
      .set({ name: input.name?.trim(), nameEn: cleanEn(input.nameEn), slug: input.slug })
      .where(eq(eventCategories.id, id))
      .returning();
    if (!row) return new CategoryNotFound();
    await forgetCategoryEvents(id);
    return toCategory(row);
  } catch (error) {
    if (isUniqueViolation(error)) return new CategoryTaken();
    throw error;
  }
}

export async function deleteCategory(id: string) {
  try {
    const [row] = await db.delete(eventCategories).where(eq(eventCategories.id, id)).returning();
    return row ? toCategory(row) : new CategoryNotFound();
  } catch (error) {
    // events.category_id is ON DELETE RESTRICT, so a category in use can't go
    if (isForeignKeyViolation(error)) return new CategoryInUse();
    throw error;
  }
}
