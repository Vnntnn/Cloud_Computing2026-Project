import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { createAccessControl } from 'better-auth/plugins/access'
import { admin } from 'better-auth/plugins/admin'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { bearer } from 'better-auth/plugins/bearer'
import { jwt } from 'better-auth/plugins/jwt'
import { env } from '../env.ts'
import { db } from './db.ts'

/**
 * better-auth instance — owns `/api/auth/*` (SYSTEM-DESIGN §3.1, §5.1).
 *
 * The better-auth CLI reads this file's `.options` to generate the Drizzle
 * schema, so it must stay importable without a database connection.
 */
const socialProviders =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : undefined

const accessControl = createAccessControl({
  ...defaultStatements,
  event: ['create', 'update', 'publish', 'close', 'suspend'],
  checkIn: ['create', 'list'],
  payment: ['reconcile'],
} as const)

const attendee = accessControl.newRole({
  user: [],
  session: [],
  event: [],
  checkIn: [],
  payment: [],
})

const organizer = accessControl.newRole({
  user: [],
  session: [],
  event: ['create', 'update', 'publish', 'close'],
  checkIn: ['create', 'list'],
  payment: [],
})

const administrator = accessControl.newRole({
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'get', 'update'],
  session: ['list', 'revoke', 'delete'],
  event: ['create', 'update', 'publish', 'close', 'suspend'],
  checkIn: ['create', 'list'],
  payment: ['reconcile'],
})

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  // CSRF origin allow-list. Deployed, the SPA is same-origin as auth; in dev the
  // Vite proxy makes the browser origin localhost:5173 (SYSTEM-DESIGN §5.5).
  trustedOrigins: [
    env.BETTER_AUTH_URL,
    ...env.TRUSTED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ],

  // Drizzle adapter (CLAUDE.md). Table names match better-auth's model names
  // (user/session/account/verification/jwks), so no schema mapping is needed —
  // the adapter reads them off the `db` instance's registered schema.
  database: drizzleAdapter(db, { provider: 'pg' }),

  user: {
    additionalFields: {
      phone: { type: 'string', required: false, input: false },
      organizerDisplayName: { type: 'string', required: false, input: false },
      organizerContactEmail: { type: 'string', required: false, input: false },
      organizerContactPhone: { type: 'string', required: false, input: false },
      organizerApprovalStatus: {
        type: ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'],
        required: true,
        defaultValue: 'NOT_APPLIED',
        input: false,
      },
      organizerApprovedAt: { type: 'date', required: false, input: false },
      organizerRejectReason: { type: 'string', required: false, input: false },
    },
  },

  // DB-backed rate limiting (SYSTEM-DESIGN §5.1) — on in deployed environments,
  // off locally so `db:seed` can create the demo users in one pass. better-auth
  // only enables rate limiting in production by default; this mirrors that.
  rateLimit: {
    enabled: env.NODE_ENV === 'production',
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
    },
  },

  // Google OAuth *and* email/password (SYSTEM-DESIGN §5.1.1). Email/password is
  // always on — the seed Job cannot create OAuth users, and it is the demo-day
  // fallback. Google is added only when its credentials are present.
  emailAndPassword: { enabled: true },
  ...(socialProviders ? { socialProviders } : {}),

  plugins: [
    // Mints asymmetric (EdDSA/Ed25519) JWTs and exposes GET /api/auth/jwks.
    // event and registration fetch those public keys and verify locally with
    // `jose` — no hop to auth, no DB call (SYSTEM-DESIGN §5.1). The private key
    // lives in `auth_db.jwks`, encrypted with BETTER_AUTH_SECRET.
    jwt({
      jwt: {
        definePayload: ({ user }) => ({
          sub: user.id,
          email: user.email,
          role: user.role ?? 'attendee',
          organizerApprovalStatus: user.organizerApprovalStatus ?? 'NOT_APPLIED',
        }),
      },
    }),
    // Accept `Authorization: Bearer <token>` and return `set-auth-token` on
    // sign-in, instead of relying on a cookie — identical behaviour local vs
    // deployed, no SameSite juggling (SYSTEM-DESIGN §5.5).
    bearer(),
    admin({
      ac: accessControl,
      roles: { attendee, organizer, admin: administrator },
      defaultRole: 'attendee',
      adminRoles: ['admin'],
    }),
  ],
})
