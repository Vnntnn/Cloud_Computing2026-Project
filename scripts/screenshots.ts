/**
 * Capture the screenshots referenced by docs/SITEMAP.md.
 *
 *     make dev && make seed        # services on :3000-:3003, SPA proxy on :5173
 *     bun run scripts/screenshots.ts
 *
 * Same setup as apps/web/test/e2e.md — puppeteer-core driving the installed Chrome.
 * Personas are signed in over the HTTP API and their session token is injected into
 * localStorage as `eventide.bearer`, the key apps/web/src/lib/auth.ts reads. No form
 * filling, so a change to the login page cannot silently break the capture.
 */
import puppeteer, { type BrowserContext, type Page } from 'puppeteer-core'

const BASE = process.env.WEB_URL ?? 'http://localhost:5173'
const OUT = new URL('../docs/screenshots', import.meta.url).pathname
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PASSWORD = process.env.SEED_PASSWORD ?? 'seed-password-123'
const BEARER_KEY = 'eventide.bearer'

/** An event owned by the seeded organizer (somchai@eventide.test). */
const EVENT_ID = process.env.EVENT_ID ?? 'f8be0ec2-5874-47c7-9a94-d9eefdf97117'

type Shot = { file: string; path: string }

const PUBLIC: Shot[] = [
  { file: '01-home', path: '/' },
  { file: '02-events', path: '/events' },
  { file: '03-event-detail', path: `/events/${EVENT_ID}` },
  { file: '04-login', path: '/login' },
]

const ATTENDEE: Shot[] = [
  { file: '05-tickets', path: '/tickets' },
  { file: '06-orders', path: '/orders' },
  { file: '07-profile', path: '/profile' },
  { file: '08-event-detail-auth', path: `/events/${EVENT_ID}` },
]

const ORGANIZER: Shot[] = [
  { file: '09-org-events', path: '/organizer/events' },
  { file: '10-org-new', path: '/organizer/events/new' },
  { file: '11-org-edit', path: `/organizer/events/${EVENT_ID}/edit` },
  { file: '12-org-images', path: `/organizer/events/${EVENT_ID}/images` },
  { file: '13-org-sales', path: `/organizer/events/${EVENT_ID}/sales` },
  { file: '14-org-checkin', path: '/organizer/check-in' },
]

const ADMIN: Shot[] = [
  { file: '15-admin-events', path: '/admin/events' },
  { file: '16-admin-users', path: '/admin/users' },
  { file: '17-admin-payments', path: '/admin/payments' },
  { file: '18-admin-audit', path: '/admin/audit' },
  { file: '19-admin-checkin', path: '/admin/check-in' },
]

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const token = response.headers.get('set-auth-token')
  if (!token) throw new Error(`no token for ${email}: ${response.status} ${await response.text()}`)
  return token
}

async function pageFor(context: BrowserContext, token?: string): Promise<Page> {
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  if (token) {
    // Runs before every document, including about:blank, where storage access throws.
    await page.evaluateOnNewDocument(
      (key: string, value: string) => {
        try {
          window.localStorage.setItem(key, value)
        } catch {}
      },
      BEARER_KEY,
      token,
    )
  }
  return page
}

async function shoot(page: Page, shots: Shot[]) {
  for (const shot of shots) {
    await page.goto(BASE + shot.path, { waitUntil: 'networkidle0' })
    // Let TanStack Query settle after the initial paint before the shutter.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const landed = page.url().replace(BASE, '')
    if (!landed.startsWith(shot.path)) {
      throw new Error(`${shot.path} redirected to ${landed} — wrong persona or expired session`)
    }
    await page.screenshot({ path: `${OUT}/${shot.file}.png`, fullPage: true })
    console.log(`  ✓ ${shot.file}.png  ${landed}`)
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })

const personas = [
  ['public', undefined, PUBLIC],
  ['attendee (priya)', 'priya@eventide.test', ATTENDEE],
  ['organizer (somchai)', 'somchai@eventide.test', ORGANIZER],
  ['admin', 'admin@eventide.test', ADMIN],
] as const

for (const [label, email, shots] of personas) {
  console.log(`${label}:`)
  const context = await browser.createBrowserContext()
  const page = await pageFor(context, email ? await signIn(email) : undefined)
  await shoot(page, shots)
  await context.close()
}

await browser.close()
console.log('done')
