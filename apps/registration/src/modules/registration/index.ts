import { Elysia, t } from 'elysia'
import { RegistrationModel } from './model.ts'
import { RegistrationService } from './service.ts'

/**
 * Controller = one Elysia instance. Unbroken method chain (Eden depends on it).
 * TODO(week2): a `.use(authMacro)` guard resolving `{ userId }` onto context.
 */
export const registration = new Elysia({ prefix: '/api/registrations', tags: ['registrations'] })
  .model(RegistrationModel)
  .get('/me', () => RegistrationService.listMine('anonymous'), {
    response: { 200: t.Array(RegistrationModel.ticket) },
    detail: { summary: 'List my tickets' },
  })
