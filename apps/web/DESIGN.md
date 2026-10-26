---
name: Eventide
description: A night-market programme for finding events: ink-dark scenes, marigold, the date as the poster, and quiet teal-tinted neutrals everywhere else.
colors:
  primary: "oklch(0.511 0.096 186.391)"
  primary-foreground: "oklch(0.984 0.014 180.72)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.2 0.03 205)"
  secondary: "oklch(0.965 0.008 205)"
  muted-foreground: "oklch(0.49 0.03 205)"
  accent: "oklch(0.955 0.012 200)"
  border: "oklch(0.915 0.01 205)"
  input: "oklch(0.64 0.02 205)"
  ring: "oklch(0.62 0.07 190)"
  destructive: "oklch(0.5 0.22 27.3)"
  dark-background: "oklch(0.165 0.022 205)"
  dark-card: "oklch(0.21 0.028 205)"
  dark-foreground: "oklch(0.985 0.005 195)"
  dark-muted-foreground: "oklch(0.73 0.03 200)"
  dark-primary: "oklch(0.437 0.078 188.216)"
  dark-chart-2: "oklch(0.704 0.14 182.503)"
  dusk: "oklch(0.2 0.045 205)"
  dusk-mid: "oklch(0.3 0.07 196)"
  dusk-low: "oklch(0.45 0.095 188)"
  dusk-foreground: "oklch(0.985 0.012 185)"
  sun: "oklch(0.83 0.15 78)"
  sun-deep: "oklch(0.7 0.18 45)"
  sun-foreground: "oklch(0.24 0.05 200)"
  sand: "oklch(0.94 0.035 85)"
  poster-1: "oklch(0.2 0.045 205)"
  poster-1-ink: "oklch(0.83 0.15 78)"
  poster-2: "oklch(0.52 0.19 38)"
  poster-2-ink: "oklch(0.93 0.07 85)"
  poster-3: "oklch(0.45 0.2 328)"
  poster-3-ink: "oklch(0.88 0.12 70)"
  poster-4: "oklch(0.36 0.14 275)"
  poster-4-ink: "oklch(0.84 0.12 195)"
  poster-5: "oklch(0.83 0.15 78)"
  poster-5-ink: "oklch(0.5 0.19 29)"
  poster-6: "oklch(0.42 0.1 160)"
  poster-6-ink: "oklch(0.9 0.14 110)"
typography:
  display:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "clamp(2.5rem, 0.9rem + 5.9vw, 6rem)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.375
  body:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
  numeral:
    fontFamily: "Google Sans Variable, sans-serif"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  ticket-code:
    fontFamily: "Google Sans Code Variable, monospace"
    fontSize: "1.25rem"
    fontWeight: 600
    letterSpacing: "0.3em"
rounded:
  edge: "4px"
  sm: "calc(0.625rem * 0.6)"
  md: "calc(0.625rem * 0.8)"
  lg: "0.625rem"
  pill: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "40px"
  section: "64px"
  section-lg: "96px"
components:
  search-field:
    backgroundColor: "{colors.dusk-foreground}"
    textColor: "{colors.sun-foreground}"
    height: "56px"
  search-submit:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.sun-foreground}"
    height: "40px"
  button-sun:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.sun-foreground}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 24px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 12px"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    height: "36px"
  card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "24px"
  dialog:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "24px"
  date-block:
    backgroundColor: "{colors.poster-2}"
    textColor: "{colors.dusk-foreground}"
    rounded: "{rounded.sm}"
    width: "104px"
  date-block-compact:
    backgroundColor: "{colors.poster-1}"
    rounded: "{rounded.sm}"
    width: "64px"
    height: "72px"
  live-mark:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.sun-foreground}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  ticket-stub:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.md}"
  qr-tile:
    backgroundColor: "#ffffff"
    textColor: "#0a0a0a"
    rounded: "{rounded.md}"
    padding: "4px"
---

# Design System: Eventide

## Overview

**Creative North Star: "The Night Market Programme"**

Eventide reads as a night-market "what's on" programme. A market photograph is graded into a teal-black ground (dusk), the headline crosses its edge in white and marigold, and every event is a date numeral before it is a card. That scene is not confined to the home page. Any page whose first screen should feel like a place (home, an event's hero, the sign-in panel, a 404) opens in the same ink with the same marigold, and the navbar takes the ink's colour while the page is at the top. Everywhere else the product is a quiet, light-or-dark teal-tinted working surface: neutrals carry the ink's hue (205) at low chroma, so a form page and the hero belong to one family even though one is lit and one is not.

Type is Google Sans, bold, tightly tracked, with giant tabular numerals as the recurring device. Colour is coded by category: six poster colourways, taken from the tents of the hero photograph, follow a category onto its posters, date blocks, chips and index rows. The wave lines from the logo are the only decorative texture on objects. Each surface class is art-directed on purpose (see Components, "Surface by surface"): public surfaces get scene and flair, functional ones (tickets, orders, enrolment) stay legible, dashboards stay neutral.

Density is editorial on public pages (64 to 112px of vertical air, one large element beside a ledger of small ones) and operational in the dashboard.

**Key Characteristics:**
- Dusk teal-black scenes with marigold as the single bright voice; sand as the one warm light ground.
- The date numeral is the poster: bold, tabular, set large in the category's ink.
- Six category colourways, stable per category, never per theme.
- One radius rule: content blocks and cards 6 to 8px, floating surfaces 10px, things you press are pills.
- Solid surfaces: no frosted glass; depth is tone, rings and a few named shadows.
- Motion is an entrance (plate wipe, text reveal), rows that rise as the page is scrolled to them, and hover moves, on one easing; nothing ambient on public content.
- Three recognisable signatures: the date numeral, the **canopy edge** (an ink scene ends in a row of tent roofs) and the **hour ruler** (a day of 24 hours with the event's span filled in its category colour).

## Creative Direction

**Chosen on 2026-10-26: "The Night Programme", the working name of this pass: an evolution of the Night Market Programme, which stays the Creative North Star above, not a replacement.** Three directions were weighed against the rendered product (home, listings, event page, tickets, auth, dashboard): a *Cultural Atlas* (maps, indexes, timelines), a *Living Poster Archive* (the date as poster across every surface) and *After-Hours Editorial* (cinematic, lit, layered). The atlas fits the data worst (events have no geography to draw) and the pure poster archive was already the incumbent's one trick, repeated on every card. The winner keeps the after-hours scene and the poster as the two registers the product already earns, and adds what the atlas does best: a **programme** that organises time. So listings are read as a printed programme (a billboard for the first event, then months set in type), an event states *when* as well as *which day* (the hour ruler), and the ink scenes end the way the photograph's tents do (the canopy edge). Each signature has a job: the numeral says which day, the ruler says which hours, the canopy says "scene over, the working page begins".

What the direction asks of each surface class: public discovery is composed (a lead, then a rhythm of months), event detail is editorial (scene, then tickets in the category's colour, then the facts as an index), tickets are precise (ink stubs, a plain white QR), account pages are calm, dashboards are quiet. The same tokens carry all of it.

## Colors

A night scene lit by one marigold, over a teal-tinted neutral theme that keeps the brand teal for actions.

### Primary
- **Eventide Teal** (`primary`): buttons, links, active nav state and the icon beside every page and section heading. In dark mode the fill drops to `dark-primary` and heading icons and active states switch to `dark-chart-2` for contrast. A brand commitment. On ink scenes it is not used as a fill; marigold carries the actions there.

### Secondary
- **Marigold** (`sun`): the action and emphasis colour on dusk and sand: hero second line, search submit, "get tickets" and the ways-on buttons of 404, the live mark, scene icons, focus ring on dusk.
- **Ember** (`sun-deep`): declared; no shipped use found. Not a rule.

### Neutral
- **Ink-tinted neutrals** (`foreground`, `secondary`, `muted-foreground`, `accent`, `border`; dark: `dark-background`, `dark-card`, `dark-foreground`, `dark-muted-foreground`): every neutral carries hue 205 at chroma 0.003 to 0.04. Light background is pure white. Dark cards sit above the page (`dark-card` over `dark-background`). Secondary text is `muted-foreground` (4.5:1 or better on its ground).
- **Control border** (`input`): the border of every form control. It is a deliberate mid-tone, 3.3:1 on white in light mode, and `oklch(0.78 0.03 200 / 55%)` (3.4:1 on the dark page and cards) in dark mode, to meet WCAG 1.4.11. It is not the hairline `border`; do not swap them.
- **Focus** (`ring`): a teal ring, 3px at 50 percent, plus a border shift to `ring`. On ink it becomes `sun` (marigold ring; a filled button swaps its fill to `dusk-foreground`).
- **Night Ink** (`dusk`): scene ground, closing band, ink navbar state, dark-mode Upcoming section, poster-1. `dusk-mid` is the dark-mode Kinds ground; `dusk-low` is declared but unused.
- **Lantern White** (`dusk-foreground`) is text on ink and the hero search field's fill. **Dark Teal Type** (`sun-foreground`) is text on marigold, sand and light posters.
- **Sand** (`sand`): light-mode ground of the Upcoming section (dusk in dark mode); `.on-sand` darkens muted text on it.
- **Destructive** (`destructive`): errors, invalid fields, the route-error icon.

### Poster colourways
Each pair is ground and ink (`poster-N`, `poster-N-ink`); they are retuned objects, the same in light and dark.
- **1 Ink and marigold**, **2 Vermilion and cream**, **3 Orchid and apricot**, **4 Indigo and cyan**, **5 Marigold and vermilion** (the one light ground, takes dark text), **6 Market green and lime**.
- A category's colourway is a function of its slug alone (`colourwayOf` in `src/lib/poster.ts`). Six slugs are chosen on purpose, one colourway each so none of them can collide: `general` night ink (1), `startup` vermilion (2), `sport` orchid (3), `food` indigo (4), `workshop` marigold (5), `music` green (6). Any other slug takes a stable hash of itself among colourways 2 to 6 (night ink stays `general`'s). A date block with no category (`DateBlock` default slug `general`) is night ink.
- Poster layout (0 bottom-left, 1 top-right, 2 centred) is the event's own, from its id (`layoutOf`).

### Named Rules
**The One Lamp Rule.** On ink and sand, marigold is the only bright accent. Teal is not a fill on a scene.

**The Category Colour Rule.** A category's colourway is the same on its poster, date block, chip, thumbnail and index row. Colourways mean a category; they are not status or button colours.

**The Scene Is Theme-Proof Rule.** Dusk, sun, sand and poster tokens are declared once in `:root` and never redefined in `.dark`. Sections that adapt (Upcoming, Kinds) switch ground with `dark:` classes.

**The Three-to-One Rule.** A control's border is `input` (at least 3:1 against its ground). `border` is for dividers and card outlines only.

## Typography

**Font:** Google Sans Variable (Latin and Thai), `sans-serif` fallback, for display, body and labels. Code and ticket codes: Google Sans Code Variable.

**Character:** one family, one bold voice. Hierarchy is size, weight 700 and numerals, never a second face.

### Hierarchy
- **Display** (700, clamp(2.5rem, 0.9rem + 5.9vw, 6rem), 1.18, tracking-tight): the home hero headline; two blocks so Thai phrases balance.
- **Scene title** (700, clamp(2.25rem, 1rem + 3.8vw, 4.25rem), 1.2): event hero title; 404 and notice scenes use clamp(2.5rem, 1rem + 5vw, 5rem), 1.2.
- **Page title, lg** (700, 2.25rem to 3rem, 1.25, tracking-tight, balance): `PageHeader size="lg"`, public and account pages, with a 32 to 40px icon. Auth titles are 1.875 to 2.25rem at 1.3.
- **Page title, md** (700, 1.5rem to 1.875rem, 1.3): `PageHeader` default, dashboard and forms, 24 to 28px icon.
- **Headline** (700, 2.25rem to 3rem, 1.2): home section headings with a 32px icon. Section headings on detail pages are 1.5 to 1.875rem.
- **Title** (700, 1.25rem to 1.875rem, snug): event titles in cards and the ledger, ticket-type names (1.125rem).
- **Numeral** (700, tabular-nums, tight): date blocks 1.875rem (compact), 3rem to 3.75rem; ticket-type price 1.125rem to 1.875rem; poster day 66 to 80 percent of the poster's smaller side (container query units).
- **Body** (400, 1rem to 1.25rem); rich text 1rem at 1.75 line height, max 68ch. **Label** (600, 0.75 to 0.875rem): month, category, venue, time, badges.
- **Ticket code** (mono 600, 1.25rem, 0.3em tracking): the printed code under a QR.

### Named Rules
**The Thai Line-Height Rule.** Large Thai headings never go tighter than 1.18; use 1.2 (hero, scene, headline), 1.25 (lg page titles, ticket title) and 1.3 (md and auth titles, route error). Never `leading-none` on text; only an oversized decorative numeral (0.78) is set tighter, and it is `aria-hidden`.

**The Numeral Rule.** Dates are bold tabular numerals; the day is the largest thing in an event's row, card or poster.

## Layout

Pages sit in the root container with 16px padding; full-bleed scenes (home sections, `NoticeScene`, `AuthLayout`) cancel it with `-m-4` and set content in `max-w-7xl` with 16px side padding. Reading pages narrow: tickets order `max-w-2xl`, profile `max-w-5xl`, auth forms `max-w-md`. Vertical rhythm is 64px (`py-16`) rising to 96 to 112px from `sm` on editorial sections; heading to content gap 40px; form stacks use 24 to 32px.

Two-column detail layouts use a main column and a fixed side column: event page `minmax(0,1fr) / 22rem`, enrolment `1fr / 20rem`, both with a sticky aside (`lg:sticky lg:top-21`, under the 68px bar). Home keeps its billboard (7fr cover, 5fr words) over a two-column ledger. Auth is a two-part screen: an ink panel and the form (`1fr / 30 to 36rem`), the panel above the form on phones.

Breakpoints in use: `sm` 640px (icons become icon-only, larger type), `lg` 1024px (columns, plates to the side). The navbar is 68px (`h-17`), sticky.

## Elevation & Depth

Flat and solid. Depth comes from tone (ink against white, card against page), one-pixel rings (`ring-1 ring-foreground/10` on cards, `/5` on floating surfaces) and hairlines. There is no frosted glass: menus, selects, popovers, the dashboard save bar and the editor toolbar are solid `popover` or `background` fills. Overlays dim with `bg-black/80` (the dialog scrim still carries a light blur).

### Shadow Vocabulary
- **Lift** (`shadow-xl`): the hero search field on its photograph; the generated poster on an event hero.
- **Floating** (`shadow-2xl` + ring): dropdown menus, selects, popovers. Toasts and the save bar use `shadow-lg`. Date blocks over a photograph use `shadow-md`.
- **Ticket outline** (four one-pixel `drop-shadow`s in `foreground` at 38 percent, 22 percent in dark mode, via `--ticket-outline`): the only way a notched ticket gets an outline, since a mask would clip a border; a single blurred shadow was too faint to outline a white piece on a white page.

### Named Rules
**The Solid Surface Rule.** A floating surface is an opaque fill with a ring. No backdrop blur on menus, bars or toolbars.

**The Graded Photograph Rule.** A photograph is washed into the ink with masks and gradients (`.hero-plate`, the auth panel's gradient, the band's `from-dusk`). It is never a framed, bordered or rounded picture on a scene. In a card or list a photograph is a plain cover with the theme radius.

## Shapes

One radius rule, from `--radius` 0.625rem: **content blocks and cards are 6 to 8px** (`sm` 6px: date blocks, posters, thumbnails, live mark, ticket-type tiles and pieces of a ticket at `md` 8px, cards, alerts, empty states, rich-text editor), **floating surfaces are 10px** (`lg`: dialogs, popovers, menus, selects' lists, toasts), and **controls are pills** (buttons, inputs, selects, input groups, tabs, badges, save bar; textarea is the one 10px control). The category chip alone is 4px. Scene sections are 0. Rows are separated by hairlines, not boxes.

The recurring silhouettes: the poster (a flat colour field, five wave lines in a 1.2px non-scaling stroke at 40 percent, an oversized numeral cropped by the edge) and the ticket (two pieces torn along a dashed line with a half-circle notch of 9px at each end of the tear).

## Components

### Foundations in motion
- **Easing:** one, `--ease-out-expo` (cubic-bezier(0.16, 1, 0.3, 1)). Durations: fast 150, base 300, slow 800ms.
- **Reveal** (`.reveal` + `reveal(ms)` from `src/lib/reveal.ts`): 600ms, 0.35em rise from 6px blur, staggered 60 to 420ms; used for scene titles, hero details and auth headers. **Plate wipe** (`.hero-plate img`): 1400ms, clip from 45 percent inset, scale 1.08 to 1. **Card entrance:** 300ms fade and 2 rise, staggered 70ms per card up to 8. **Hover moves:** 300 to 700ms, image scale 1.03, numeral up 2px.
- **Rise** (`.rise-in`): a heading, a ledger row or an event card eases up 1.75rem and fades in as it scrolls into view. It is a native scroll-driven animation (`animation-timeline: view()`, range `entry 0% entry 40%`), gated by `prefers-reduced-motion: no-preference` and `@supports`, so a browser without it simply shows the content; things already in the first screen are already past the range. It replaces the old per-card entrance.
- **Route changes** cross-fade through the router's view transition (`defaultViewTransition`); nothing else is shared between pages.
- **The lantern** (home hero only, `.lantern` + `data-lit`): the wash that darkens the photograph opens in a 17rem pool around the pointer (about a fifth brighter at its centre, soft to its edge, no hard circle). `--lit` (a registered number, transitioned over 600ms) fades the pool in and out; `HomeHero` eases the pointer position (measured on the photograph, because the mask lives there, not on the section) into `--mx` and `--my` with one `requestAnimationFrame` write per frame while it settles and no React state. The CSS and the script both apply only for a fine pointer without reduced motion.
- **The cursor** (`CursorRing`, public pages only): the ring trails the pointer, swells over links, hides over text fields and turns marigold over an ink scene. Over an element with `data-cursor="…"` (an event's cover) the ring gives way to a marigold label that says what a click does ("View" / "ดู"). The label is a marigold disc with a dark ring and a lifted shadow, so it still reads over a marigold poster. Both elements are `aria-hidden` with `pointer-events: none`; neither is mounted to anything under `/dashboard`, they do nothing on touch or under reduced motion, and the native cursor is never replaced.
- **Reduced motion:** `prefers-reduced-motion` collapses every animation and transition to 0.01ms.
- **Focus:** 3px ring, never removed; on ink it is marigold. Anything that draws no ring of its own (a plain link) gets the base rule in `index.css`: a 2px outline in its own text colour, which has the contrast of its text against its ground in either theme and on the ink scenes (measured 6.1:1 light, 8.2:1 dark for a muted link), so every focus indicator clears 3:1 (WCAG 1.4.11).

### Buttons
Pill (`rounded-4xl`), 36px default, 32 small, 40 large, 24 extra-small. A button carries an icon when the icon says something the word does not (`data-icon="inline-start"`): an action with an obvious glyph (create, search, share, sign in), a direction (arrow), a state (spinner, check). A plain "Save" or "Cancel" needs none (see Iconography). Primary is teal with `primary-foreground`; outline uses the 3:1 `input` border; destructive is a tinted fill. On ink and sand: the `sun` variant at size `xl` (marigold fill, dark teal text, 48px, 24px side padding and 20px beside an icon, hover at 85 percent, focus swaps to `dusk-foreground` with a marigold ring; `button-sun`); the secondary on ink is the `inkOutline` variant at `xl`: a 55 percent Lantern White border on solid ink, so a wave line never shows through it. These are variants of `buttonVariants()`, not class overrides, because `cn` does not resolve conflicting utilities.

### Form fields and the 3:1 control border
Field = label, control, error. The label is words only; the icon that used to sit beside every label repeated the word. Inputs, selects and input groups are 36px pills with a solid `background` fill and an `input` border; the hover and focus move the border to `ring` with a 3px ring at 50 percent. Invalid fields take `destructive` border and a 20 percent ring (40 in dark mode). Errors show only once touched. Textarea is 10px and grows with its content.

### PageHeader
The title of a page: an `h1`, an optional description (`max-w-2xl`, muted), and actions to the right, wrapping beneath on a phone. `size="md"` (default) is for the dashboard and forms and carries a lucide icon in the primary (dark: chart-2) that echoes the sidebar item; `size="lg"` is for public and account pages (tickets, profile, status, browse) and is type alone: the editorial title does not take an icon, and the prop is ignored there.

### EventPoster, CategoryChip, DateBlock
The signature objects. **EventPoster:** the cover of an event with no photograph, ground and ink from the category, tide lines, the day numeral in layout 0, 1 or 2; category and month appear at container widths of 9rem and up, and `bare` leaves them out so the caller sets its own words. It is `aria-hidden`; the date is always written beside it. **CategoryChip:** the same wave on a small 4px ground, 16px beside a category name (`Kind`). **DateBlock:** the date in the category's ground with the day in its ink (3rem to 3.75rem; `compact` 1.875rem, 64 by 72px) and the month under it, 6px radius with a faint ring; over a photograph in a card it sits at the top left with `shadow-md`. A generated poster never also gets a DateBlock. **EventThumb:** a small photograph or a tiny poster (layout 2, bare) for lists and tables, 6px radius; the dashboard uses it so operators scan by picture.

### EventCard and the ledger
An event in a list: a 16:10 cover (6px radius) over a kind chip and name, a title of up to two lines (20px bold, underlined on hover and focus), date range and venue with icons. A live event adds the `LiveMark` (a still dot, no pulse). Cards enter with the staggered 300ms fade. On home the same events are a billboard and a ledger of DateBlocks separated by hairlines, and the kinds are a type-set index whose rows fill with the category's colourway on hover.

### HourRuler and the canopy edge
**HourRuler** (`event-parts.tsx`): a ruler of 24 hours (ticks every hour, labels at 00, 06, 12, 18, 24) with the event's span filled as a bar in the category's ground (outlined in its ink in dark mode, where the darker colourways fall below 3:1 on the page). An event that crosses midnight fills to the end of its first day. It sits under the billboard's facts on home and listings and under "date and time" on the event page. It is a picture of the time and always has the written date and hours beside it, so it is `aria-hidden`. The ticks are the one repeating-stripe texture on the neutral ground, and they are earned because they are a measuring scale.

**Canopy edge** (`.canopy`, `effects.css`): where an ink scene ends, a strip in the next section's colour (`--canopy-fill`, the page ground by default) is cut into a row of upward points, `clamp(10px, 1.1vw, 16px)` tall, the tents of the photograph. It is a boundary, not a texture: it carries no content, never animates and appears only on the bottom edge of an ink scene (the home hero, the event hero, the enrol header). The home hero sets `--canopy-fill` to sand in light mode, or to the page ground when there is no Upcoming section. In dark mode there is no canopy (`.dark .canopy::after`): the ink scene and the page are the same family, and a cut between two near-identical darks would be a mark nobody can see.

### EventHero
The top of an event page, on ink with `InkScene`: back link, badges, title (reveal 60ms), when/where/duration with marigold icons (reveal 160ms), and a marigold "get tickets" button (reveal 240ms) unless the event has ended. With a photograph, the picture is washed into the ink behind the words (right 64 percent on wide screens, a 22rem band on a phone). Without one, the event's poster (layout 1, 6px radius, `shadow-xl`) sits beside the words (above on a phone); the date numeral appears in the hero only for poster-cover events.

### TicketStub
A ticket drawn as two pieces torn along a dashed line (`.ticket-h` side by side, `.ticket-v` stacked), a `stub` piece (price or date) and the rest. Decoration only: the pieces are ordinary blocks, so content, focus and selection behave as in any card. Used for ticket types on the event page, orders and tickets in lists, and the ticket itself. `stubStyle` gives the stub its own ground: on the event page a ticket type's stub wears the category's colourway with the price in its ink (so the ticket belongs to its kind of event), and a ticket in "my tickets" has a night-ink stub with a marigold QR glyph.

### AuthLayout
Sign-in, sign-up and the password pages: an ink panel (market photograph graded into the ink, the home hero's two headline lines, credit line) beside the form on the page's own ground; the title with icon and the form reveal on entrance (60 and 150ms). It marks the page `InkScene`.

### NoticeScene, NotFound, RouteError
`NoticeScene` is a full-height ink page for something that cannot be shown: a title (scene scale), a sentence, ways on (marigold "home", outline "events"), tide lines and an optional oversized numeral mark (the 404, set the way a poster sets a date, `aria-hidden`). `NotFound` is the default for unknown routes. `RouteError` is the one non-scene fallback: a plain statement with a destructive icon, retry and home, and the message only in development.

### Navigation
Sticky 68px bar: logo, language switch, theme toggle, then the page links (explore for everyone; "My tickets" once signed in; "Dashboard" for organizers and admins; the page you are on is tinted) and the account (sign in and sign up, or the user menu, which keeps the same links); labels collapse to icons below `sm`, and on a phone an organizer or admin also loses the wordmark (the logo mark stays) to make room for the third link. Under an `InkScene` and at scroll under 24px it takes the dusk ground, light text and no border, and its outline button becomes transparent; past that and on every other page it is `background` with a border.

### Iconography

One family: lucide at its default 2px stroke, sized by context (16px in buttons, inputs and rows, 20px beside a fact heading, 24px in page headers of the dashboard) and never given a size class inside `Button`. Colour follows role: foreground or muted for chrome, the primary for dashboard header and fact icons, marigold on ink, destructive for errors.

**Use an icon when it adds meaning the words do not:** an action with a recognised glyph (search, share, copy, create, sign in), a direction (arrows, chevrons), a status or state that must not rest on colour alone (status badges, spinners, ticket availability), and navigation items (sidebar, user menu), where the glyph is the scanning handle. **Leave it out when it repeats the word:** form field labels, section and card headings on public and account pages, form legends, definition rows, plain "Save" and "Cancel". Emoji are never icons. Icon-only buttons have an accessible name; an icon beside text is decorative and carries no label of its own.

This replaces the earlier rule that put an icon on every button, field label, heading, nav item and empty state; that rule produced a glyph beside nearly every line and no hierarchy between them.

### Page titles
Every page sets its browser tab title as "<page> | Eventide" in the current language (`pageTitle()`, `usePageTitle()`). A route declares a fixed title with `staticData: { title: "<message key>" }` and the root `PageTitle` applies it; a page whose title carries data sets it itself: an event's name, a ticket or order ("Ticket · <event>", "Order · <event>", "Register · <event>", the `common.pageTitle` messages), a dashboard event's tab ("Attendees · <event>"). The home page is just "Eventide". Titles follow the language switch live and never use an id or a slug.

### Alerts and dialogs
An `Alert` is a grid of icon and text; its `AlertAction` sits under the text, never over it. Red (`destructive`) is for something that has failed or will destroy; a standing advisory (an invitations tab on a public event) is the neutral card. The dashboard sidebar is a drawer below `lg` (1024px).

### Surface by surface
- **Home (brand and discovery):** the fullest expression: ink hero with graded photograph, search, programme of the next three events, billboard and ledger, kind index, closing band. Marigold and the six colourways at full strength; reveal and plate wipe once.
- **Listings (`/events`, category pages):** discovery on the neutral ground, composed as a programme. `PageHeader lg`, a pill search group and toggles, category chips, then the first event set as the home page's `Billboard` (when the list has four or more) and the rest under the month they fall in: each month a heading in type over a rule, with a grid of `EventCard`s beneath it (the repeated-card grid is kept because the cover is the content). Headings and cards rise on scroll; the pointer over a cover shows "View". No ink scene; the dot grid sits behind the top (the only page that has it).
- **Event detail:** ink `EventHero` ending in the canopy edge, then a light body: the ticket types as `TicketStub`s whose stubs wear the category colourway, with live seat counts; the rich description (68ch); a "Your tickets" list under the ticket types when the viewer owns any for the event (bought by them or sent to their email; each a ticket piece that opens its QR), and a sticky aside of facts (when with its hour ruler, where, refunds) and sharing. Section headings are type alone. Marigold is the only action on the hero; below it actions are teal.
- **Tickets and order status (functional):** `PageHeader lg`, tickets as `TicketStub`s, order cards, status badges and honest deadlines. A ticket shows the event on ink above the tear and the code below it: the QR is black (`#0a0a0a`) on a white tile with a 4px margin plus the printed code in mono, away from every decoration, so it scans; it is never tinted, rounded past the tile, overlaid or animated. List date blocks dim (60 percent) once an event has ended.
- **Enrol:** an ink header (`InkScene`, back link, event title) over a plain form: attendee cards, per-ticket-type questions, a sticky summary aside with hold countdown and refund terms. Accuracy over expression: no reveal on fields, no poster.
- **Auth:** `AuthLayout` for sign-in, sign-up, forgot and reset password.
- **Profile and account:** `PageHeader lg`, sectioned cards; neutral, no scene.
- **Dashboards (operational):** neutral, tabular and scannable (PRODUCT.md principle 4). `PageHeader md`, data tables, editors, a sticky save bar (solid, pill). No ink scene, no marigold, and the pointer ring is not mounted under `/dashboard`. Category colour appears only as information: `EventThumb` in event lists and the chip beside each name on the admin categories page. The Overview is a list of what needs the viewer (an admin sees named organizer requests with a Review link, and a one-line user count) over the latest events with their status counts; there are no metric cards. Data tables follow one narrow-table rule, decided by the table's own width (a container query, 56rem), not the screen's, because an open sidebar takes 16rem of a laptop: the row's action (the last column) is sticky at the edge, below 56rem the table's `mobileFold` ids (status, role, organization) move under the first cell's name instead of being columns, and below 42rem its `mobileHide` ids drop dates and totals; the first column may wrap and the action column hugs the right edge, and a soft shadow marks the edge with more behind it (`.scroll-hint`, also on the event tab strip). A change that moves what an account may do (a role change) asks first in an alert dialog; destructive buttons use `--destructive`, set to 5.6:1 as text on its own tint.
- **Status, 404, errors:** `/status` is a `PageHeader lg` list of services with the only spinner. Unknown routes get `NotFound` in ink; thrown errors get `RouteError`; both are the defaults in `main.tsx`.

## Do's and Don'ts

### Do:
- **Do** set every event date as a bold tabular numeral, largest in its row, card or poster.
- **Do** colour posters, date blocks, chips, thumbnails and index rows from the category's colourway through `colourwayOf` and the `--poster-N` tokens.
- **Do** keep marigold the one bright accent on ink and sand, with dark teal text on it, and teal for actions on the neutral ground.
- **Do** follow the radius rule: 6 to 8px content, 10px floating, pills for controls, 4px for the chip.
- **Do** put `InkScene` on a page whose first screen is ink, and open it with `reveal` and the one easing.
- **Do** give a page its title through `PageHeader` (`lg` public and account, type alone; `md` dashboard, with its icon).
- **Do** end an ink scene with the canopy edge, and tell a day's hours with the hour ruler beside the written time.
- **Do** put `data-cursor="…"` on a cover that opens something, with a translated word, and nothing else.
- **Do** give an outline control its `input` border by letting the variant carry it (`border-transparent` lives on the filled variants, not on the button base), and check a restyled variant by its computed style.
- **Do** border controls with `input` (3:1) and dividers with `border`.
- **Do** keep a QR black on white with its printed code, and write the date and category as text beside any poster.
- **Do** use `.on-sand` on sand, and give photographs their provenance in `docs/assets.md` with a credit on the page.

### Don't:
- **Don't** use frosted glass or backdrop blur on menus, selects, bars or toolbars.
- **Don't** put a photograph in a frame, border or rounded card on a scene; grade it into the ink.
- **Don't** decorate, tint, round or animate a ticket's QR.
- **Don't** redefine dusk, sun, sand or poster tokens in `.dark`.
- **Don't** use the six colourways as status or button colours.
- **Don't** carry the ink scene, marigold or pointer flair into the dashboard.
- **Don't** add a second texture beside the wave lines, or ambient animation to public content. The canopy edge and the hour ruler are boundary and scale, not textures: do not repeat them as backgrounds.
- **Don't** put an icon beside a label, heading or legend that already says the same in words.
- **Don't** let a cursor label, ring or lantern take a click, hide a control or run on touch or under reduced motion.

## Not canonized

Known drift and defects the build carries, recorded so they are not inherited and not repaired here:
- The dot-grid `.page-backdrop` and the pointer-following `CursorRing` come from the visual-flair branch. Decision (reconciling PRODUCT.md with this file): the dot grid stays only behind the events listing (`/events`, category pages; `DotGrid` in `routes/__root.tsx`), the one page that wants a light printed-paper ground, and was removed from tickets, orders, account, status and enrol pages where it was noise. The ring runs on public pages and is not mounted under `/dashboard`. Neither is part of the home world; new surfaces should not extend them.
- My-tickets date blocks and stubs are night ink because the registration API sends no category, so they break the Category Colour Rule.
- The event hero shows the date numeral only for poster-cover events; photograph events carry the date as text.
- The hash fallback of `colourwayOf` can give an unlisted category the colourway of another (five colourways are free); only the six seeded slugs are chosen.
- `cn` (the `cn` package) only joins class names; it does not resolve conflicting Tailwind classes. This once left every outline button with a transparent border (the button base carried `border-transparent`, which sorts after `border-input`); `button.tsx` now puts `border-transparent` on the filled variants only. Still, a `className` on `buttonVariants()` or a component that restyles a variant's border, fill or size must use the important modifier (`border-dusk-foreground/40!`, `size-16!`) or it can lose to the variant's own class by stylesheet order. Check a restyle by its computed style, not by the class list.
- `sun-deep` and `dusk-low` are declared and unused. Event page badges (`rounded-full`) and a few hand-set `rounded-[4px]` values sit outside the radius rule's named steps.
