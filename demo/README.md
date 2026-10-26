# The prepared demo

The database is new every session (`make down` deletes it), so a fresh deploy shows an empty site. `make deploy` therefore ends by
seeding a prepared demo, and `make demo` seeds it by hand. The seed uses the **public API** (so every validation and cache
invalidation of the real services applies), is **idempotent** (it does nothing when the demo accounts exist) and never enrolls or
pays, because those paths send real mail and touch Stripe.

```sh
make deploy                 # ends with the demo (SEED_DEMO=0 make deploy skips it)
make demo                   # the deployed system, by hand
cat demo/.credentials       # the accounts and their password (mode 600, gitignored)
bun test demo/              # checks the data (no system needed; CI runs it)
```

## What it creates

**Accounts** (one password for the three, random unless `DEMO_PASSWORD` is set):

| Role | What it is for |
|---|---|
| admin | categories, users, organizer applications, suspending events |
| organizer ("Siam Live Events", approved) | the event dashboard, ticket types, check-in; the event pages show "organized by" this name |
| attendee | enrolling and paying as a buyer (the demo does not enroll for you) |

**Categories**, each with a Thai and an English name (the site shows the English one when it is switched to English):
ทั่วไป / General, ดนตรี / Music, สตาร์ทอัพ / Startup, กีฬา / Sports, อาหารและตลาด / Food & Markets, เวิร์กช็อป / Workshop.

**Events** (dates are relative to the day of the seed, so they are always upcoming; times are Bangkok time):

| Event | Shows |
|---|---|
| Bangkok Jazz Night | two paid first-come tickets, a choice question, an 80% refund policy until 48 h before |
| Startup Pitch Night #5 | an **approval** ticket (the organizer approves each application, with three questions) next to a free audience ticket |
| เวิร์กช็อปถ่ายภาพสตรีทด้วยมือถือ | a Thai event with a paid ticket and a 100% refund policy |
| Chiang Mai Street Food Festival | a free event with a large quota |
| Bangkok Community Run 10K | required questions (shirt size, emergency contact), a 50% refund policy |
| Eventide Product Day | an **invite-only** event (`invite` ticket); invitations are only sent to `DEMO_INVITE_EMAILS` |
| Year-End Gala 2026 | a **scheduled** event: hidden from the public until its publish time |
| Community Meetup (draft) | a **draft**: only the organizer sees it |

Anonymous visitors see five of the eight: the draft, the scheduled and the invite-only event are not public.

## Mail

Approving the organizer, and inviting guests, send real mail. An address nobody owns would bounce, be retried and end up in the
dead-letter queue (and trip the `mail-dlq-not-empty` alarm). So the accounts are made on a mailbox you own: with a Gmail sender
configured (`GMAIL_USER` in `.env`, or `DEMO_MAIL_USER`) they are `you+demo-admin@gmail.com`, `you+demo-organizer@gmail.com`, ...,
which Gmail delivers to you. Without one they are `demo-admin@eventide.test` and so on, which is fine while mail runs dry.

## Settings

| Variable | Meaning |
|---|---|
| `BASE_URL` | the origin to seed (set from the Terraform outputs by `scripts/seed-demo.sh`) |
| `PROMOTE_CMD` | how the demo admin is made (no API does that, by design). Default: a one-off pod, `bash scripts/admin.sh {email}`. Locally: `cd apps/auth && bun run admin:promote {email}` |
| `DEMO_PASSWORD` | the password of the three accounts |
| `DEMO_MAIL_USER` | the mailbox the account addresses are built on |
| `DEMO_INVITE_EMAILS` | comma-separated real addresses to invite to the invite-only event |
| `DEMO_OUT` | where the credentials are written (default `demo/.credentials`) |

## Running it on a local stack

Use a separate database so your dev data is not touched, and do not start the mail worker if a Gmail sender is configured:

```sh
docker exec <postgres container> psql -U postgres -c "create database eventide_demo"
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/eventide_demo
bun run db:migrate
(cd apps/auth && bun run dev) & (cd apps/event && bun run dev) & (cd apps/registration && bun run dev) & (cd apps/web && bun run dev) &
BASE_URL=http://localhost:5173 PROMOTE_CMD='cd apps/auth && bun run admin:promote {email}' DEMO_OUT=/tmp/demo.credentials bun demo/seed.ts
```

## If a seed fails half way

The demo admin exists by then, so a re-run would skip and leave the demo partial. Reset the database (the next `make deploy` on a
new one is clean) or delete the demo users, then run it again. A seed that fails before creating anything says so and can simply be
re-run.

## Changing the data

Edit `demo/seed.ts` (`categories`, `events`) and run `bun test demo/`: it checks the slugs, the dates (future, the hour written),
the ticket rules (price 0 or at least 20, quota only on first-come, 2-20 distinct options on a choice), the refund policies and that
every kind of ticket and every state is still shown. A slug outside the six with their own colour in `apps/web/src/lib/poster.ts` is
given a colour from a hash and can look like another category.
