// The colours and layout of a generated poster. Shared by EventPoster, the category chips and whatever sets text on them.

/** A number from a string, so the same slug or event id always gets the same result. */
function hashOf(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // seeds that differ only at the end hash to nearby numbers; mixing the bits spreads them across the colourways
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Ground and ink come from the --poster-N tokens. "dark": light text reads on the ground; "light": dark text does. */
const colourways = [
  { ground: "var(--poster-1)", ink: "var(--poster-1-ink)", tone: "dark" }, // night ink, marigold
  { ground: "var(--poster-2)", ink: "var(--poster-2-ink)", tone: "dark" }, // vermilion, cream
  { ground: "var(--poster-3)", ink: "var(--poster-3-ink)", tone: "dark" }, // orchid, apricot
  { ground: "var(--poster-4)", ink: "var(--poster-4-ink)", tone: "dark" }, // indigo, cyan
  { ground: "var(--poster-5)", ink: "var(--poster-5-ink)", tone: "light" }, // marigold, vermilion
  { ground: "var(--poster-6)", ink: "var(--poster-6-ink)", tone: "dark" }, // green, lime
] as const;

/**
 * Categories whose colourway is chosen on purpose, by slug (index into `colourways`). `general` ("ทั่วไป", the category the
 * migration that introduced categories gave every existing event) takes the signature night ink. The other five are the
 * categories the seeded data and the demo use; each has its own colourway, so no two of them ever look alike (two of them
 * used to collide on the hash). Every other category is made by an admin at runtime, so its slug is not known here; it
 * falls through to the hash below. When a category that matters is created, add its slug to this table.
 */
const chosen: Record<string, number> = { general: 0, startup: 1, sport: 2, food: 3, workshop: 4, music: 5 };

/**
 * A category's colourway, a function of its slug alone: adding, removing or reordering categories never recolours another
 * one. A slug in `chosen` gets its fixed colourway; any other takes one from a hash of the slug. A finite palette cannot be
 * unique for an unbounded number of categories, so an unlisted category can share a colourway with another. The fallback
 * skips night ink, which is `general`'s alone.
 */
export const colourwayOf = (categorySlug: string) => {
  const fixed = chosen[categorySlug.toLowerCase()];
  return fixed !== undefined ? colourways[fixed] : colourways[1 + (hashOf(categorySlug) % (colourways.length - 1))];
};

/** The poster layout (0 to 2) is the event's own, from its id; the colourway is the category's. */
export const layoutOf = (eventId: string) => (hashOf(eventId) >>> 5) % 3;
