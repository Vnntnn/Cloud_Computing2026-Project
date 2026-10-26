import { describe, expect, test } from "bun:test";
import { categoryName } from "../src/lib/category-name.ts";
import { colourwayOf } from "../src/lib/poster.ts";
import { pageTitle, SITE_NAME } from "../src/lib/site.ts";

describe("colourwayOf", () => {
  const seeded = ["general", "startup", "sport", "food", "workshop", "music"];

  test("the six seeded categories each have their own colourway", () => {
    const grounds = seeded.map((slug) => colourwayOf(slug).ground);
    expect(new Set(grounds).size).toBe(seeded.length);
  });

  test("a colourway depends on the slug alone, and not on its case", () => {
    expect(colourwayOf("Music")).toEqual(colourwayOf("music"));
    expect(colourwayOf("a-new-category")).toEqual(colourwayOf("a-new-category"));
  });

  test("night ink belongs to `general`: no other slug falls back to it", () => {
    const ink = colourwayOf("general").ground;
    for (const slug of ["a", "b", "c", "concert", "kids", "art", "tech", "รัก", "x".repeat(40), "festival-2026"]) {
      expect(colourwayOf(slug).ground).not.toBe(ink);
    }
  });
});

describe("pageTitle", () => {
  test("names the page and the site, or just the site", () => {
    expect(pageTitle("My tickets")).toBe(`My tickets | ${SITE_NAME}`);
    expect(pageTitle("ตั๋วของฉัน")).toBe(`ตั๋วของฉัน | ${SITE_NAME}`);
    expect(pageTitle()).toBe(SITE_NAME);
    expect(pageTitle("")).toBe(SITE_NAME);
  });
});

describe("categoryName", () => {
  const music = { name: "ดนตรี", nameEn: "Music" };

  test("the English name in English, the Thai one in Thai", () => {
    expect(categoryName(music, "en")).toBe("Music");
    expect(categoryName(music, "th")).toBe("ดนตรี");
  });

  test("a category without an English name shows the Thai one in both languages", () => {
    expect(categoryName({ name: "ทั่วไป", nameEn: null }, "en")).toBe("ทั่วไป");
    expect(categoryName({ name: "ทั่วไป" }, "en")).toBe("ทั่วไป");
    expect(categoryName({ name: "ทั่วไป", nameEn: "" }, "en")).toBe("ทั่วไป");
  });
});
