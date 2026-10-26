import { t, type UnwrapModels, type UnwrapSchema } from "elysia";
import { SLUG_PATTERN } from "../../libs/slug";

const Id = t.String({ format: "uuid" });
const Name = t.String({ minLength: 1, maxLength: 60, pattern: "\\S" });
// the English name: optional, and null clears it (the Thai name is then shown in both languages)
const NameEn = t.Nullable(t.String({ minLength: 1, maxLength: 60, pattern: "\\S" }));
const Slug = t.String({ minLength: 2, maxLength: 60, pattern: SLUG_PATTERN });

// nameEn is optional in the response too: an event cached in Redis before the column existed has no such key
export const Category = t.Object({ id: t.String(), name: t.String(), nameEn: t.Optional(t.Nullable(t.String())), slug: t.String() });
export type Category = UnwrapSchema<typeof Category>;

export const Get = { Response: t.Array(Category) };
export type Get = UnwrapModels<typeof Get>;

export const Post = { Body: t.Object({ name: Name, nameEn: t.Optional(NameEn), slug: Slug }), Response: Category };
export type Post = UnwrapModels<typeof Post>;

export const ByIdPatch = {
  Params: t.Object({ id: Id }),
  Body: t.Object({ name: t.Optional(Name), nameEn: t.Optional(NameEn), slug: t.Optional(Slug) }),
  Response: Category,
};
export type ByIdPatch = UnwrapModels<typeof ByIdPatch>;

export const ByIdDelete = { Params: t.Object({ id: Id }), Response: Category };
export type ByIdDelete = UnwrapModels<typeof ByIdDelete>;
