import { Elysia } from 'elysia'
import { AuthService } from './service.ts'

/**
 * Controller = one Elysia instance. Unbroken method chain (Eden depends on it).
 * TODO(week2): `.mount(betterAuth.handler)` for `/api/auth/*`.
 */
export const auth = new Elysia({ prefix: '/api/auth', tags: ['auth'] }).get('/status', () => ({
  ok: true,
  detail: AuthService.placeholder(),
}))
