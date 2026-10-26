# Image assets

Images on the home page (`apps/web/public/art/`). They are **atmosphere**, not Eventide events: a Hubble photograph of a
star cluster in its nebula (the hero), a night market (now only on the sign-in panel) and the crowd at a gig. Nothing on the page says they were taken
at an Eventide event.

All come from Wikimedia Commons and were checked against the file's own licence metadata (the Commons API's
`LicenseShortName` and `Restrictions` fields, not a third-party summary). The two photographs by people are **CC BY 2.0**, which allows
commercial use and adaptation as long as the author is credited and changes are indicated; the Hubble image is **public domain** (a NASA release), credited anyway. The page credits them in
the closing band (`HostBand` in `apps/web/src/routes/index.tsx`) and says they were cropped, mirrored and colour-graded.

| Local file | Used in | Original | Author | Licence |
|---|---|---|---|---|
| `hero-nebula.webp` | hero (the image the headline crosses) | [NASA Unveils Celestial Fireworks as Official Hubble 25th Anniversary Image.jpg](https://commons.wikimedia.org/wiki/File:NASA_Unveils_Celestial_Fireworks_as_Official_Hubble_25th_Anniversary_Image.jpg) (Westerlund 2) | NASA, ESA, the Hubble Heritage Team (STScI/AURA) | Public domain |
| `hero-market.webp` | sign-in panel (it was the hero until 2026-10-26: lossy at 1600 px and busy behind the headline) | [Train Night Market Ratchada (34079339800).jpg](https://commons.wikimedia.org/wiki/File:Train_Night_Market_Ratchada_(34079339800).jpg) | aotaro (Yokohama, Japan) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `crowd.webp` | closing "host your own event" band | [Hands up for the band.jpg](https://commons.wikimedia.org/wiki/File:Hands_up_for_the_band.jpg) | Grey World | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |

## People in the pictures

A CC licence covers the photographer's copyright, not the rights of people who appear in a photo, and Eventide has no
release from anyone shown. So the photographs were chosen so that nobody in them can be identified:

- `hero-nebula.webp` is a star cluster and gas: no people. (Tried first: a sky-lantern festival (CC BY 2.0, Jirka Matousek, crowd cropped off) and Bangkok New Year fireworks (CC BY 3.0, PEAK99); both are night photographs, soft and noisy at full size, which read as blur on a large hero.)
- `hero-market.webp` is an aerial view of tent roofs; the few vendors and diners visible are small and seen from above
  or behind.
- `crowd.webp` is a backlit crowd of silhouettes, converted to a two-colour duotone.

An earlier version used a portrait of a woman releasing a lantern and a close shot of a band on stage. Both show
identifiable people with no release, so they were removed. If a photograph with a recognisable face is ever added, get
a release first.

## Changes made to the originals

- `hero-nebula.webp`, `-2400`, `-1400` (2026-10-26): the 8919 x 6683 px original **mirrored** (so the bright gas is on the right, behind the 3D tickets, and the dark star field on the left, behind the headline) and cropped to 8919 x 4100, black level lifted to the hero's ink colour (`#001b20`) so the dark sky meets the page without an edge, resized to 4000 / 2400 / 1400 px wide, WebP q86 / 84 / 82, metadata stripped. 796 / 316 / 133 KB.
- `hero-market.webp`: cropped to the right-hand 2540 x 2100 px of the 3840 px download (away from the diners in the
  lower left), resized to 1600 px wide, exported as WebP with metadata stripped. The page darkens and fades it into the
  ink colour with CSS (`.hero-plate` in `src/effects.css`); the file itself is not graded.
- `hero-market-800.webp`, `hero-market-1200.webp` (2026-10-26): the 1600 px file resized down, for `srcset` on the home hero and
  the sign-in panel, so a phone downloads 153 KB instead of 604 KB (the hero image is the page's largest-contentful-paint
  element, so it keeps `fetchpriority="high"`). Sizes: 800 w = 153 KB, 1200 w = 322 KB, 1600 w = 604 KB.
- `crowd.webp`: resized to 2200 px wide and converted to a duotone (dark teal to amber).

Originals are not kept in the repository; the Commons links above are the source.

```sh
magick hubble_full.jpg -flop -crop 8919x4100+0+1300 +repage -level 2%,100% +level-colors '#001b20,white' -strip hub_master.png
magick hub_master.png -resize 4000x -quality 86 hero-nebula.webp
magick hub_master.png -resize 2400x -quality 84 hero-nebula-2400.webp
magick hub_master.png -resize 1400x -quality 82 hero-nebula-1400.webp
magick market_full.jpg -crop 2540x2100+1300+60 +repage -resize 1600x -strip -quality 68 hero-market.webp
magick hero-market.webp -resize 800x  -strip -quality 66 hero-market-800.webp
magick hero-market.webp -resize 1200x -strip -quality 64 hero-market-1200.webp
magick crowd_big.jpg   -resize 2200x -colorspace Gray -level 6%,96% +level-colors '#06191c,#ffd58a' -strip -quality 72 crowd.webp
```

`hubble_full.jpg` is the original file of the Hubble page (`Special:FilePath/<file>`, 64 MB), `market_full.jpg` is the 3840 px rendition of the file page (`.../thumb/7/76/..._(34079339800).jpg/3840px-...jpg`),
`crowd_big.jpg` the 3840 px rendition of the second one.

## Generated artwork

Events without a cover photograph get a poster drawn in code (`apps/web/src/components/event-poster.tsx`): the event's
day number set large in the colours of its category, with the logo's wave lines behind it. The six colourways are the
`--poster-N` tokens in `apps/web/src/index.css` (taken from the colours of the tents in the hero photograph) and the
mapping from category to colourway is `colourwayOf()` in `apps/web/src/lib/poster.ts` (six slugs are chosen on purpose: `general`, `startup`, `sport`, `food`, `workshop`, `music`; any other slug takes a stable hash of itself). No image files, no licence.

## Original artwork (no external source)

The three glossy tickets over the home hero (`apps/web/src/components/hero-ticket-3d.tsx`) are modelled in code with three.js (an inflated extrusion of the ticket outline, a clear-coat material), and wear the theme's colours. The reflections are a sky painted on a 2D canvas, the paper's fleck a generated roughness map, the printed wordmark and barcode drawn on canvases, a spark shader for the tear. No model, texture or HDRI file, nothing to license.

The canopy edge (`.canopy` in `src/effects.css`), the hour ruler (`HourRuler`), the poster and the wave lines are drawn in CSS
and inline SVG from geometry, so there is nothing to license or credit for them. No image was generated with an AI tool and
the only image added in the 2026-10-26 pass is the hero's Hubble photograph above.
