import { queryOptions } from "@tanstack/react-query";
import { Ban, CalendarClock, FileText, Globe, MailCheck, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { eventClient } from "./api";
import { isValidDate } from "./format";

export type EventStatus = "draft" | "public" | "invite" | "suspended";

type BadgeVariant = "secondary" | "default" | "outline" | "destructive";

export const statusInfo: Record<EventStatus, { label: string; description: string; icon: LucideIcon; variant: BadgeVariant }> = {
  draft: {
    get label() {
      return t("shared.eventStatus.draft.label");
    },
    get description() {
      return t("shared.eventStatus.draft.description");
    },
    icon: FileText,
    variant: "secondary",
  },
  public: {
    get label() {
      return t("shared.eventStatus.public.label");
    },
    get description() {
      return t("shared.eventStatus.public.description");
    },
    icon: Globe,
    variant: "default",
  },
  invite: {
    get label() {
      return t("shared.eventStatus.invite.label");
    },
    get description() {
      return t("shared.eventStatus.invite.description");
    },
    icon: MailCheck,
    variant: "outline",
  },
  suspended: {
    get label() {
      return t("shared.eventStatus.suspended.label");
    },
    get description() {
      return t("shared.eventStatus.suspended.description");
    },
    icon: Ban,
    variant: "destructive",
  },
};

/** A public event whose publish time is still ahead: it shows as scheduled rather than public. */
export const scheduledInfo = {
  get label() {
    return t("shared.eventStatus.scheduled");
  },
  icon: CalendarClock,
  variant: "outline" as BadgeVariant,
};

export const isScheduled = (event: { status: EventStatus; publishAt: string | null }) =>
  event.status === "public" && !!event.publishAt && new Date(event.publishAt) > new Date();

export const hasEnded = (event: { endsAt: string }) => new Date(event.endsAt) < new Date();

// a missing start would read as the epoch ("already started"), so unreadable dates are never live
export const isLive = (event: { startsAt: string; endsAt: string }) => {
  if (!isValidDate(event.startsAt) || !isValidDate(event.endsAt)) return false;
  const now = new Date();
  return new Date(event.startsAt) <= now && now <= new Date(event.endsAt);
};

export const eventsKey = ["events"] as const;

type Page = { page?: number; pageSize?: number; q?: string };

export const categoriesQueryOptions = queryOptions({
  queryKey: [...eventsKey, "categories"],
  queryFn: async () => {
    const { data, error } = await eventClient.api.events.categories.get();
    if (error) throw error;
    return data;
  },
  staleTime: 5 * 60_000,
});

export type Category = NonNullable<Awaited<ReturnType<typeof eventClient.api.events.categories.get>>["data"]>[number];


export const publicEventsQueryOptions = (
  query: Page & { categoryId?: string; organizerId?: string; when?: "upcoming" | "past" },
) =>
  queryOptions({
    queryKey: [...eventsKey, "public", query],
    queryFn: async () => {
      const { data, error } = await eventClient.api.events.get({ query });
      if (error) throw error;
      return data;
    },
  });

export const myEventsQueryOptions = (query: Page & { status?: EventStatus }) =>
  queryOptions({
    queryKey: [...eventsKey, "mine", query],
    queryFn: async () => {
      const { data, error } = await eventClient.api.events.mine.get({ query });
      if (error) throw error;
      return data;
    },
  });

export const eventDetailKey = (idOrSlug: string) => [...eventsKey, "detail", idOrSlug] as const;

// A 4xx (missing, hidden, no access) won't change on retry; only network and server errors are retried.
export const retryUnlessClientError = (failures: number, error: unknown) => {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  return !(status >= 400 && status < 500) && failures < 3;
};

// the id may also be a slug
export const eventQueryOptions = (idOrSlug: string) =>
  queryOptions({
    queryKey: eventDetailKey(idOrSlug),
    queryFn: async () => {
      const { data, error } = await eventClient.api.events({ id: idOrSlug }).get();
      if (error) throw error;
      return data;
    },
    retry: retryUnlessClientError,
  });

export const slugAvailableQueryOptions = (slug: string, excludeId?: string) =>
  queryOptions({
    queryKey: [...eventsKey, "slug-available", slug, excludeId],
    queryFn: async () => {
      const { data, error } = await eventClient.api.events["slug-available"].get({ query: { slug, excludeId } });
      if (error) throw error;
      return data.available;
    },
    staleTime: 10_000,
  });

export type EventSummary = NonNullable<
  Awaited<ReturnType<typeof eventClient.api.events.mine.get>>["data"]
>["items"][number];

export type EventDetail = NonNullable<Awaited<ReturnType<ReturnType<typeof eventClient.api.events>["get"]>>["data"]>;

export const eventUrl = (slug: string) => `${window.location.origin}/events/${slug}`;

/** ISO → "YYYY-MM-DDTHH:mm" in the browser's timezone, the value the date-time picker works with. */
export function toLocalInput(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const fromLocalInput = (value: string) => new Date(value).toISOString();

/**
 * Moving the start keeps the event's length, like a calendar app: the end moves by the same amount.
 * Falls back to start + 3 hours when the end is missing or wasn't after the old start.
 */
export function shiftEnd(previousStart: string, nextStart: string, end: string) {
  const next = new Date(nextStart).getTime();
  if (Number.isNaN(next)) return end;
  const previous = new Date(previousStart).getTime();
  const endTime = new Date(end).getTime();
  const duration = !Number.isNaN(previous) && !Number.isNaN(endTime) && endTime > previous ? endTime - previous : 3 * 3_600_000;
  return toLocalInput(new Date(next + duration));
}

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a slug input keeps while typing: lowercase, spaces become hyphens, anything else is dropped. */
export const normalizeSlugInput = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-");

/** Field the service's problem codes belong to, so the editor can show them in place. */
export const problemFields: Record<string, string> = {
  SLUG_TAKEN: "slug",
  INVALID_SLUG: "slug",
  CATEGORY_NOT_FOUND: "categoryId",
  INVALID_SCHEDULE: "endsAt",
  INVALID_REFUND: "refundCutoffHours",
};

export function problemCode(error: unknown) {
  const value = error && typeof error === "object" && "value" in error ? error.value : undefined;
  return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : undefined;
}
