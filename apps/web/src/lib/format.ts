import { getLocale, intlLocale, t } from "@/i18n";

// one formatter per (language, shape): built on first use, since the language can change
const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();
function formatter<T extends Intl.DateTimeFormat | Intl.NumberFormat>(
  kind: "date" | "number",
  name: string,
  options: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions,
): T {
  const locale = intlLocale[getLocale()];
  const key = `${locale}:${name}`;
  let found = cache.get(key);
  if (!found) {
    found = kind === "date" ? new Intl.DateTimeFormat(locale, options) : new Intl.NumberFormat(locale, options);
    cache.set(key, found);
  }
  return found as T;
}
const dt = (name: string, options: Intl.DateTimeFormatOptions) => formatter<Intl.DateTimeFormat>("date", name, options);
const nf = (name: string, options: Intl.NumberFormatOptions) => formatter<Intl.NumberFormat>("number", name, options);

type DateInput = Date | string | null | undefined;

/** False for a missing value or one that doesn't parse. Intl throws a RangeError on an invalid date. */
export const isValidDate = (value: DateInput): value is Date | string =>
  value != null && value !== "" && !Number.isNaN(new Date(value).getTime());

/** What every date formatter prints instead of a date it can't read, rather than throwing or a made-up date. */
export const NO_DATE = "—";

const date = (name: string, options: Intl.DateTimeFormatOptions) => (value: DateInput) =>
  isValidDate(value) ? dt(name, options).format(new Date(value)) : NO_DATE;

export const formatDateTime = date("dateTime", { dateStyle: "medium", timeStyle: "short" });
export const formatDate = date("date", { dateStyle: "medium" });
/** "ศ. 12 ธ.ค. 2569" / "Fri, 12 Dec 2026" */
export const formatLongDate = date("longDate", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** "19:00" */
export const formatTime = date("time", { hour: "2-digit", minute: "2-digit" });
/** "12", "ธ.ค." / "Dec" (the event card's calendar badge) */
export const formatDay = date("day", { day: "numeric" });
export const formatMonth = date("month", { month: "short" });
/** "ธันวาคม 2569" / "December 2026" */
export const formatMonthYear = date("monthYear", { month: "long", year: "numeric" });
/** 1,200 in the current language */
export const formatNumber = (value: number) => nf("number", {}).format(value);

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "ศ. 12 ธ.ค. 2569 · 19:00–22:00", or both full dates when the event spans days. Without a start, no date; without an end, just the start. */
export function formatDateRange(start: DateInput, end: DateInput) {
  if (!isValidDate(start)) return NO_DATE;
  const from = new Date(start);
  if (!isValidDate(end)) return `${formatLongDate(from)}\u00a0·\u00a0${formatTime(from)}`;
  const to = new Date(end);
  // U+2060 (word joiner) either side of the dash keeps "01:04–07:04" from breaking across two lines
  if (sameDay(from, to)) return `${formatLongDate(from)}\u00a0·\u00a0${formatTime(from)}\u2060–\u2060${formatTime(to)}`;
  // a multi-day range may only break at its dash, never inside an end ("Tue, 10 Nov / 2026 21:00")
  const end1 = `${formatLongDate(from)} ${formatTime(from)}`.replace(/ /g, "\u00a0");
  const end2 = `${formatLongDate(to)} ${formatTime(to)}`.replace(/ /g, "\u00a0");
  return `${end1} – ${end2}`;
}

const bahtOptions: Intl.NumberFormatOptions = { style: "currency", currency: "THB", maximumFractionDigits: 0 };

/** "฿1,200", or "ฟรี" / "Free" for 0 */
export const formatPrice = (value: number) => (value === 0 ? t("common.free") : nf("baht", bahtOptions).format(value));

/** "฿1,200", or "฿62.50" when there are satang (a partial refund can have them) */
export const formatBaht = (value: number) =>
  Number.isInteger(value) ? nf("baht", bahtOptions).format(value) : nf("bahtSatang", { style: "currency", currency: "THB" }).format(value);

/** "3 ชั่วโมง 30 นาที" / "3 hours 30 minutes" */
export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days && t("common.duration.day", { n: days }),
    hours && t("common.duration.hour", { n: hours }),
    rest && t("common.duration.minute", { n: rest }),
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : t("common.duration.minute", { n: 0 });
}
