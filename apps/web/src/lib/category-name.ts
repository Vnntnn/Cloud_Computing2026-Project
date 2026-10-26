// no imports, so the unit tests can load it: the locale is the same "th" | "en" as `Locale` in i18n/index.ts
/**
 * A category's name in the site's language. Categories are data an admin types, not site text, so each carries its own
 * English name (`nameEn`); a category without one shows its Thai name in both languages.
 */
export const categoryName = (category: { name: string; nameEn?: string | null }, locale: "th" | "en") =>
  locale === "en" && category.nameEn ? category.nameEn : category.name;
