import { beforeEach, describe, expect, it } from 'bun:test'
import { user, userAuditLogs } from '@eventide/db/auth'
import { desc, eq, sql } from 'drizzle-orm'
import { app } from '../src/index.ts'
import { db } from '../src/lib/db.ts'

const decodeJwt = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())

const json = (path: string, body: unknown, token?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )

async function signUp(email: string) {
  const res = await json('/api/auth/sign-up/email', {
    name: email,
    email,
    password: 'password-1234',
  })
  if (!res.ok) throw new Error(`sign-up ${email}: ${res.status} ${await res.text()}`)
  const sessionToken = res.headers.get('set-auth-token')
  if (!sessionToken) throw new Error('no set-auth-token header on sign-up')
  const { user: u } = (await res.json()) as { user: { id: string } }
  return { id: u.id, sessionToken }
}

async function jwtFor(sessionToken: string) {
  const res = await app.handle(
    new Request('http://localhost/api/auth/token', {
      headers: { authorization: `Bearer ${sessionToken}` },
    }),
  )
  const { token } = (await res.json()) as { token: string }
  return token
}

async function admin() {
  const a = await signUp(`admin-${crypto.randomUUID()}@test.eventide`)
  await db.update(user).set({ role: 'admin' }).where(eq(user.id, a.id))
  return a
}

describe('auth — membership & authorization', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate "user", session, account, verification, rate_limit, user_audit_logs, login_attempts restart identity cascade`,
    )
  })

  it('a new account defaults to attendee / NOT_APPLIED and the JWT carries those claims', async () => {
    const u = await signUp(`a-${crypto.randomUUID()}@test.eventide`)
    const claims = decodeJwt(await jwtFor(u.sessionToken))
    expect(claims.sub).toBe(u.id)
    expect(claims.role).toBe('attendee')
    expect(claims.organizerApprovalStatus).toBe('NOT_APPLIED')
  })

  it('organizer application → admin approval flips the role and the JWT claim', async () => {
    const applicant = await signUp(`org-${crypto.randomUUID()}@test.eventide`)
    const appRes = await json(
      '/api/users/me/organizer-application',
      { displayName: 'Demo Org', contactEmail: 'org@test.eventide' },
      applicant.sessionToken,
    )
    expect(appRes.status).toBe(200)

    const a = await admin()
    const approve = await json(`/api/admin/organizers/${applicant.id}/approve`, {}, a.sessionToken)
    expect(approve.status).toBe(200)

    const [row] = await db.select().from(user).where(eq(user.id, applicant.id))
    expect(row?.role).toBe('organizer')
    expect(row?.organizerApprovalStatus).toBe('APPROVED')

    const logs = await db
      .select()
      .from(userAuditLogs)
      .where(eq(userAuditLogs.targetUserId, applicant.id))
      .orderBy(desc(userAuditLogs.createdAt))
    expect(logs.map((l) => l.action)).toContain('ORGANIZER_APPROVED')
  })

  it('a non-admin cannot reach the admin API', async () => {
    const u = await signUp(`x-${crypto.randomUUID()}@test.eventide`)
    const res = await app.handle(
      new Request('http://localhost/api/admin/users', {
        headers: { authorization: `Bearer ${u.sessionToken}` },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('banning a user revokes their sessions and blocks /api/users/me', async () => {
    const victim = await signUp(`ban-${crypto.randomUUID()}@test.eventide`)
    const a = await admin()

    const before = await app.handle(
      new Request('http://localhost/api/users/me', {
        headers: { authorization: `Bearer ${victim.sessionToken}` },
      }),
    )
    expect(before.status).toBe(200)

    const ban = await json(
      `/api/admin/users/${victim.id}/ban`,
      { reason: 'test abuse' },
      a.sessionToken,
    )
    expect(ban.status).toBe(200)

    const after = await app.handle(
      new Request('http://localhost/api/users/me', {
        headers: { authorization: `Bearer ${victim.sessionToken}` },
      }),
    )
    expect(after.status).toBe(401)

    const [row] = await db.select().from(user).where(eq(user.id, victim.id))
    expect(row?.banned).toBe(true)
  })
})
