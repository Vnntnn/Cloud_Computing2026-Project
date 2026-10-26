# Image assets

Photographs on the home page (`apps/web/public/art/`). They are **atmosphere**, not Eventide events: sky lanterns at a
festival, a night market (now only on the sign-in panel) and the crowd at a gig. Nothing on the page says they were taken
at an Eventide event.

Both come from Wikimedia Commons, were checked against the file's own licence metadata (the Commons API's
`LicenseShortName` and `Restrictions` fields, not a third-party summary) and are licensed **CC BY 2.0**, which allows
commercial use and adaptation as long as the author is credited and changes are indicated. The page credits them in
the closing band (`HostBand` in `apps/web/src/routes/index.tsx`) and says they were cropped and colour-graded.

| Local file | Used in | Original | Author | Licence |
|---|---|---|---|---|
| `hero-lanterns.webp` | hero (the photograph the headline crosses) | [Pingxi Sky Lantern Festival 2014 in Taiwan - 12431379143.jpg](https://commons.wikimedia.org/wiki/File:Pingxi_Sky_Lantern_Festival_2014_in_Taiwan_-_12431379143.jpg) | Jirka Matousek | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `hero-market.webp` | sign-in panel (it was the hero until 2026-10-26: lossy at 1600 px and busy behind the headline) | [Train Night Market Ratchada (34079339800).jpg](https://commons.wikimedia.org/wiki/File:Train_Night_Market_Ratchada_(34079339800).jpg) | aotaro (Yokohama, Japan) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `crowd.webp` | closing "host your own event" band | [Hands up for the band.jpg](https://commons.wikimedia.org/wiki/File:Hands_up_for_the_band.jpg) | Grey World | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |

## People in the pictures

A CC licence covers the photographer's copyright, not the rights of people who appear in a photo, and Eventide has no
release from anyone shown. So the photographs were chosen so that nobody in them can be identified:

- `hero-lanterns.webp` is a frame of lanterns only (no crowd; the same festival's other frames show hands and phones along the bottom, so that one was not used).
- `hero-market.webp` is an aerial view of tent roofs; the few vendors and diners visible are small and seen from above
  or behind.
- `crowd.webp` is a backlit crowd of silhouettes, converted to a two-colour duotone.

An earlier version used a portrait of a woman releasing a lantern and a close shot of a band on stage. Both show
identifiable people with no release, so they were removed. If a photograph with a recognisable face is ever added, get
a release first.

## Changes made to the originals

- `hero-lanterns.webp`, `-2000`, `-1200` (2026-10-26): the 4752 px original resized to 2800 / 2000 / 1200 px (the page's plate is up to ~2700 device pixels wide on a HiDPI screen), black level lifted to the hero's ink colour (`#001b20`) so the photograph's dark sky meets the page without an edge, WebP, metadata stripped. 157 / 61 / 28 KB.
- `hero-market.webp`: cropped to the right-hand 2540 x 2100 px of the 3840 px download (away from the diners in the
  lower left), resized to 1600 px wide, exported as WebP with metadata stripped. The page darkens and fades it into the
  ink colour with CSS (`.hero-plate` in `src/effects.css`); the file itself is not graded.
- `hero-market-800.webp`, `hero-market-1200.webp` (2026-10-26): the 1600 px file resized down, for `srcset` on the home hero and
  the sign-in panel, so a phone downloads 153 KB instead of 604 KB (the hero image is the page's largest-contentful-paint
  element, so it keeps `fetchpriority="high"`). Sizes: 800 w = 153 KB, 1200 w = 322 KB, 1600 w = 604 KB.
- `crowd.webp`: resized to 2200 px wide and converted to a duotone (dark teal to amber).

Originals are not kept in the repository; the Commons links above are the source.

```sh
magick lantern_full.jpg -resize 2800x -level 3%,100% +level-colors '#001b20,white' -strip -quality 80 hero-lanterns.webp
magick hero-lanterns.webp -resize 2000x -strip -quality 78 hero-lanterns-2000.webp
magick hero-lanterns.webp -resize 1200x -strip -quality 76 hero-lanterns-1200.webp
magick market_full.jpg -crop 2540x2100+1300+60 +repage -resize 1600x -strip -quality 68 hero-market.webp
magick hero-market.webp -resize 800x  -strip -quality 66 hero-market-800.webp
magick hero-market.webp -resize 1200x -strip -quality 64 hero-market-1200.webp
magick crowd_big.jpg   -resize 2200x -colorspace Gray -level 6%,96% +level-colors '#06191c,#ffd58a' -strip -quality 72 crowd.webp
```

`lantern_full.jpg` is the original file (`Special:FilePath/<file>`), `market_full.jpg` is the 3840 px rendition of the file page (`.../thumb/7/76/..._(34079339800).jpg/3840px-...jpg`),
`crowd_big.jpg` the 3840 px rendition of the second one.

## Generated artwork

Events without a cover photograph get a poster drawn in code (`apps/web/src/components/event-poster.tsx`): the event's
day number set large in the colours of its category, with the logo's wave lines behind it. The six colourways are the
`--poster-N` tokens in `apps/web/src/index.css` (taken from the colours of the tents in the hero photograph) and the
mapping from category to colourway is `colourwayOf()` in `apps/web/src/lib/poster.ts` (six slugs are chosen on purpose: `general`, `startup`, `sport`, `food`, `workshop`, `music`; any other slug takes a stable hash of itself). No image files, no licence.

## Original artwork (no external source)

The canopy edge (`.canopy` in `src/effects.css`), the hour ruler (`HourRuler`), the poster and the wave lines are drawn in CSS
and inline SVG from geometry, so there is nothing to license or credit for them. No image was generated with an AI tool and
the only photograph added in the 2026-10-26 pass is the hero's lanterns above.
