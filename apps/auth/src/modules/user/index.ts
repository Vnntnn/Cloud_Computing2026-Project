import { session, user, userAuditLogs } from '@eventide/db/auth'
import { and, desc, eq, ilike, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { auth } from '../../lib/auth.ts'
import { db } from '../../lib/db.ts'

async function currentUser(headers: Headers) {
  const current = await auth.api.getSession({ headers })
  return current?.user ?? null
}

async function audit(actorId: string, targetUserId: string, action: string, details?: unknown) {
  await db
    .insert(userAuditLogs)
    .values({ actorId, targetUserId, action, details: details ? JSON.stringify(details) : null })
}

async function revoke(targetUserId: string) {
  await db.delete(session).where(eq(session.userId, targetUserId))
}

export const users = new Elysia({ tags: ['users'] })
  .get('/api/users/me', async ({ request, status }) => {
    const me = await currentUser(request.headers)
    return me ?? status(401, { error: 'unauthorized', message: 'authentication required' })
  })
  .patch(
    '/api/users/me',
    async ({ request, body, status }) => {
      const me = await currentUser(request.headers)
      if (!me) return status(401, { error: 'unauthorized', message: 'authentication required' })
      const [updated] = await db
        .update(user)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(user.id, me.id))
        .returning()
      await audit(me.id, me.id, 'PROFILE_UPDATED')
      return updated
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        phone: t.Optional(t.String({ maxLength: 30 })),
      }),
    },
  )
  .post(
    '/api/users/me/organizer-application',
    async ({ request, body, status }) => {
      const me = await currentUser(request.headers)
      if (!me) return status(401, { error: 'unauthorized', message: 'authentication required' })
      const [existing] = await db.select().from(user).where(eq(user.id, me.id)).limit(1)
      if (
        existing?.organizerApprovalStatus === 'PENDING' ||
        existing?.organizerApprovalStatus === 'APPROVED'
      )
        return status(409, {
          error: 'application_exists',
          message: 'organizer application is already active',
        })
      const [updated] = await db
        .update(user)
        .set({
          organizerDisplayName: body.displayName,
          organizerContactEmail: body.contactEmail,
          organizerContactPhone: body.contactPhone ?? null,
          organizerApprovalStatus: 'PENDING',
          organizerApprovedAt: null,
          organizerRejectReason: null,
          updatedAt: new Date(),
        })
        .where(eq(user.id, me.id))
        .returning()
      await audit(me.id, me.id, 'ORGANIZER_APPLIED')
      return updated
    },
    {
      body: t.Object({
        displayName: t.String({ minLength: 2, maxLength: 120 }),
        contactEmail: t.String({ format: 'email' }),
        contactPhone: t.Optional(t.String({ maxLength: 30 })),
      }),
    },
  )
  .get(
    '/api/admin/users',
    async ({ request, query, status }) => {
      const me = await currentUser(request.headers)
      if (!me || me.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      const filter = query.q
        ? or(ilike(user.name, `%${query.q}%`), ilike(user.email, `%${query.q}%`))
        : undefined
      const items = await db
        .select()
        .from(user)
        .where(filter)
        .orderBy(desc(user.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
      return { items, page: query.page, pageSize: query.pageSize }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        page: t.Integer({ minimum: 1, default: 1 }),
        pageSize: t.Integer({ minimum: 1, maximum: 100, default: 20 }),
      }),
    },
  )
  .get(
    '/api/admin/audit-logs',
    async ({ request, query, status }) => {
      const me = await currentUser(request.headers)
      if (!me || me.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      return db
        .select()
        .from(userAuditLogs)
        .orderBy(desc(userAuditLogs.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
    },
    {
      query: t.Object({
        page: t.Integer({ minimum: 1, default: 1 }),
        pageSize: t.Integer({ minimum: 1, maximum: 100, default: 50 }),
      }),
    },
  )
  .post(
    '/api/admin/organizers/:userId/approve',
    async ({ request, params, status }) => {
      const me = await currentUser(request.headers)
      if (!me || me.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      const [updated] = await db
        .update(user)
        .set({
          role: 'organizer',
          organizerApprovalStatus: 'APPROVED',
          organizerApprovedAt: new Date(),
          organizerRejectReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(user.id, params.userId), eq(user.organizerApprovalStatus, 'PENDING')))
        .returning()
      if (!updated)
        return status(404, { error: 'not_found', message: 'pending application not found' })
      await revoke(params.userId)
      await audit(me.id, params.userId, 'ORGANIZER_APPROVED')
      return updated
    },
    { params: t.Object({ userId: t.String() }) },
  )
  .post(
    '/api/admin/organizers/:userId/reject',
    async ({ request, params, body, status }) => {
      const me = await currentUser(request.headers)
      if (!me || me.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      const [updated] = await db
        .update(user)
        .set({
          role: 'attendee',
          organizerApprovalStatus: 'REJECTED',
          organizerApprovedAt: null,
          organizerRejectReason: body.reason,
          updatedAt: new Date(),
        })
        .where(eq(user.id, params.userId))
        .returning()
      if (!updated) return status(404, { error: 'not_found', message: 'user not found' })
      await revoke(params.userId)
      await audit(me.id, params.userId, 'ORGANIZER_REJECTED', body)
      return updated
    },
    {
      params: t.Object({ userId: t.String() }),
      body: t.Object({ reason: t.String({ minLength: 1, maxLength: 500 }) }),
    },
  )
  .post(
    '/api/admin/users/:userId/ban',
    async ({ request, params, body, status }) => {
      const me = await currentUser(request.headers)
      if (!me || me.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      if (me.id === params.userId)
        return status(409, { error: 'self_ban', message: 'administrators cannot ban themselves' })
      const [updated] = await db
        .update(user)
        .set({
          banned: true,
          banReason: body.reason,
          banExpires: body.expiresAt ? new Date(body.expiresAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(user.id, params.userId))
        .returning()
      if (!updated) return status(404, { error: 'not_found', message: 'user not found' })
      await revoke(params.userId)
      await audit(me.id, params.userId, 'USER_BANNED', body)
      return updated
    },
    {
      params: t.Object({ userId: t.String() }),
      body: t.Object({
        reason: t.String({ minLength: 1, maxLength: 500 }),
        expiresAt: t.Optional(t.String({ format: 'date-time' })),
      }),
    },
  )
  .post(
    '/api/admin/users/:userId/unban',
    async ({ request, params, status }) => {
      const me = await currentUser(request.headers)
      if (!me || me.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      const [updated] = await db
        .update(user)
        .set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() })
        .where(eq(user.id, params.userId))
        .returning()
      if (!updated) return status(404, { error: 'not_found', message: 'user not found' })
      await revoke(params.userId)
      await audit(me.id, params.userId, 'USER_UNBANNED')
      return updated
    },
    { params: t.Object({ userId: t.String() }) },
  )
