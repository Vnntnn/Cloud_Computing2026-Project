import { t, type UnwrapModels, type UnwrapSchema } from "elysia";
import { SLUG_PATTERN } from "../../libs/slug";
import { Category } from "../categories/model";

const Id = t.String({ format: "uuid" });
const DateTime = t.String({ format: "date-time" });
const Nullable = <T extends ReturnType<typeof t.String> | ReturnType<typeof t.Number> | ReturnType<typeof t.Integer>>(
  schema: T,
) => t.Union([schema, t.Null()]);

export const Status = t.Union([
  t.Literal("draft"),
  t.Literal("public"),
  t.Literal("invite"),
  t.Literal("suspended"),
]);
export type Status = UnwrapSchema<typeof Status>;

// pattern `\S`: at least one non-space character; the service trims the rest
const Title = t.String({ minLength: 1, maxLength: 150, pattern: "\\S" });
const Slug = t.String({ minLength: 3, maxLength: 80, pattern: SLUG_PATTERN });
const Venue = t.String({ minLength: 1, maxLength: 200, pattern: "\\S" });
const VenueDescription = t.String({ maxLength: 1000 });
const VenueUrl = t.String({ maxLength: 500, pattern: "^https?://\\S+$" });
const RefundCutoffHours = t.Integer({ minimum: 0, maximum: 24 * 365 });
const RefundPercent = t.Integer({ minimum: 0, maximum: 100 });


// One shape for list rows and the detail; the list leaves `description` (HTML) out.
const Summary = {
  id: t.String(),
  slug: t.String(),
  title: t.String(),
  status: Status,
  category: Category,
  venue: t.String(),
  thumbnailUrl: Nullable(t.String()),
  startsAt: t.String(),
  endsAt: t.String(),
  publishAt: Nullable(t.String()),
  organizerId: t.String(),
};

export const EventSummary = t.Object(Summary);
export type EventSummary = UnwrapSchema<typeof EventSummary>;

export const EventDetail = t.Object({
  ...Summary,
  description: Nullable(t.String()),
  venueDescription: Nullable(t.String()),
  venueUrl: Nullable(t.String()),
  isRefundAvailable: t.Boolean(),
  refundCutoffHours: Nullable(t.Number()),
  refundPercent: Nullable(t.Number()),
  createdAt: t.String(),
  updatedAt: t.String(),
});
export type EventDetail = UnwrapSchema<typeof EventDetail>;

const Page = {
  page: t.Optional(t.Integer({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 12 })),
  q: t.Optional(t.String({ maxLength: 100 })),
};
const Paged = t.Object({ items: t.Array(EventSummary), total: t.Number() });

export const When = t.Union([t.Literal("upcoming"), t.Literal("past")]);

export const Get = {
  // upcoming (default): not ended yet, soonest first; past: ended, most recent first
  Query: t.Object({ ...Page, categoryId: t.Optional(Id), organizerId: t.Optional(Id), when: t.Optional(When) }),
  Response: Paged,
};
export type Get = UnwrapModels<typeof Get>;

export const StatusCounts = t.Object({
  draft: t.Number(),
  public: t.Number(),
  invite: t.Number(),
  suspended: t.Number(),
});

export const MineGet = {
  Query: t.Object({ ...Page, status: t.Optional(Status), organizerId: t.Optional(Id) }),
  // `counts` ignore the status filter, so status tabs can show every count at once
  Response: t.Object({ items: t.Array(EventSummary), total: t.Number(), counts: StatusCounts }),
};
export type MineGet = UnwrapModels<typeof MineGet>;

export const SlugAvailableGet = {
  Query: t.Object({ slug: t.String({ maxLength: 80 }), excludeId: t.Optional(Id) }),
  Response: t.Object({ available: t.Boolean() }),
};
export type SlugAvailableGet = UnwrapModels<typeof SlugAvailableGet>;

export const ByIdGet = {
  // a uuid or a slug
  Params: t.Object({ id: t.String({ minLength: 1, maxLength: 80 }) }),
  Response: EventDetail,
};
export type ByIdGet = UnwrapModels<typeof ByIdGet>;

export const Post = {
  Body: t.Object({
    title: Title,
    slug: t.Optional(Slug),
    categoryId: Id,
    venue: Venue,
    venueDescription: t.Optional(VenueDescription),
    venueUrl: t.Optional(VenueUrl),
    startsAt: DateTime,
    endsAt: DateTime,
  }),
  Response: EventDetail,
};
export type Post = UnwrapModels<typeof Post>;

export const ByIdPatch = {
  Params: t.Object({ id: Id }),
  Body: t.Object({
    title: t.Optional(Title),
    slug: t.Optional(Slug),
    categoryId: t.Optional(Id),
    description: t.Optional(Nullable(t.String({ maxLength: 100_000 }))),
    venue: t.Optional(Venue),
    venueDescription: t.Optional(Nullable(VenueDescription)),
    venueUrl: t.Optional(Nullable(VenueUrl)),
    status: t.Optional(Status),
    isRefundAvailable: t.Optional(t.Boolean()),
    refundCutoffHours: t.Optional(Nullable(RefundCutoffHours)),
    refundPercent: t.Optional(Nullable(RefundPercent)),
    publishAt: t.Optional(Nullable(DateTime)),
    startsAt: t.Optional(DateTime),
    endsAt: t.Optional(DateTime),
  }),
  Response: EventDetail,
};
export type ByIdPatch = UnwrapModels<typeof ByIdPatch>;

export const ByIdDelete = { Params: t.Object({ id: Id }), Response: t.Object({ id: t.String() }) };
export type ByIdDelete = UnwrapModels<typeof ByIdDelete>;
