# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Thai-speaking members of the public who browse events and buy or claim tickets, on phone and desktop. English is a supported second language, not the default.

Secondary operators, all in the same web app:
- **Organizers** create events, ticket types and registration forms, invite attendees, approve or reject enrollments, and see the attendee list. They manage only their own events.
- **Admins** manage all events, categories, accounts, and organizer applications.

## Product Purpose

Eventide is a website to find events, register, pay and hold tickets in one place, and for organizers to run those events. It is the Cloud Computing 2026 (IT KMITL) term project: the app and its AWS infrastructure are graded together, with a report and a live demo. Success is a complete, working attendee flow (browse → enroll → pay → ticket with QR) plus the organizer and admin tooling behind it.

## Positioning

Course project; no market claim. Record what it does, not how it beats other ticketing sites. Concrete behavior worth preserving: three ticket kinds (`first_come`, `approval`, `invite`), live seat counts over WebSocket, 10-minute seat holds, refund terms shown at purchase.

## Operating Context

- Roles: `user`, `organizer`, `admin` (Better Auth). Login by email/password and Google.
- Attendee flow: event page → enroll form (one attendee per ticket, per-ticket-type questions) → Stripe Checkout when paid → "my tickets" with QR.
- Organizer/admin work lives in `/dashboard`: tables, ticket-type and question editors, invitations, enrollments, refunds, applications.
- Runs live at https://eventide.creasy.club only while a Learner Lab session is up; otherwise it is shown locally.
- Link previews: crawlers get per-URL Open Graph tags and images from the server.

## Capabilities and Constraints

- Stack: Vite + React 19 SPA, TanStack Router/Query/Form/Table, shadcn on Base UI (`base-maia`), Tailwind tokens in `src/index.css`.
- Language: all UI copy goes through the i18n namespaces (`pub`, `shared`, `account`, `dashboard`, `eventAdmin`) with live Thai/English switching. `SITE_DESCRIPTION` stays Thai on purpose (shared with the server's head tags).
- Dark mode is class-based.
- Unfinished: attendee check-in and the refund-requests page in the dashboard; manual refund completion for PromptPay.

## Brand Commitments

- Name: Eventide. Logo and favicons in `apps/web/public` and the mail logo.
- Teal primary and Google Sans (Latin + Thai) from the existing theme.
- Playful tone, not noisy. The visual-flair branch's two playful touches are kept where they serve discovery: the dot grid sits only behind the events listing (`/events` and its category pages), and the pointer-following ring runs on public pages but not in the dashboard. Everything animated respects `prefers-reduced-motion`. Wave lines (the logo's motif) are the texture elsewhere. Grain was never shipped. Two further touches serve discovery and are bounded the same way: a "View" label that replaces the ring over an event cover, and the lantern on the home hero (the photograph's wash thins around the pointer); both are fine-pointer only and off under reduced motion. Icons carry meaning, not decoration (see DESIGN.md, Iconography).

## Evidence on Hand

- No testimonials, customers, usage numbers, press or case studies exist. Do not fabricate any.
- Real event data comes only from what organizers create in the running app.

## Product Principles

1. The attendee path to a ticket is the product; every screen either moves it forward or gets out of the way.
2. Thai first, English equal: nothing ships untranslated, and layouts must hold both lengths.
3. Seat and payment state must be honest: live counts, visible holds and deadlines, refund terms before paying.
4. Operator screens (dashboard) favor scanability and consistency over expression.
5. Playfulness is seasoning on public surfaces; it never costs legibility, speed or accessibility.

## Accessibility & Inclusion

WCAG 2.2 AA is the required standard. Respect `prefers-reduced-motion`. Thai text must render correctly with correct line-height and no clipped ascenders/vowel marks.
