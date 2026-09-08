# Frontend E2E — manual

No CI e2e (needs a real Chrome + all services up). Run it by hand before a demo.

## Setup

```sh
make dev            # postgres + auth(:3000) + event(:3001) + registration(:3002)
make seed           # 15 events, 4 organisers
bun run --filter @eventide/web dev    # vite on :5173, proxies /api/* to the services
```

## Flow to verify (at http://localhost:5173)

1. **Event list** (`/`) — 15 cards, each linking to a detail page.
2. **Detail** (`/events/:id`), logged out — the CTA reads **"Log in to register"**;
   clicking it goes to `/login`.
3. **Sign up** (`/login` → "Need an account? Sign up") with email/password —
   redirects to `/tickets`, `localStorage['eventide.bearer']` is set.
4. **Detail**, logged in — CTA is **"Register"**; clicking it shows
   *"Registered — see My tickets."* and bumps the `N / capacity` count.
5. **My tickets** (`/tickets`) — lists the event just booked.
6. **Log out** (nav) — clears the bearer token; `/tickets` then says *"Please log in"*.

Verified 2026-09-07 with headless Chrome (puppeteer-core driving
`/Applications/Google Chrome.app`) — 9/9 steps, no API 4xx, no page errors.

## The one non-obvious config

`auth` must trust the Vite origin for the CSRF check — its `dev` script sets
`TRUSTED_ORIGINS=http://localhost:5173`. Deployed, the SPA is same-origin as
`/api/auth` so nothing is needed.
