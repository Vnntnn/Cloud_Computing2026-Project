import { Elysia, t } from 'elysia'
import { EventModel } from './model.ts'
import { EventService } from './service.ts'

/**
 * Controller = one Elysia instance, nothing else. Kept as an unbroken method
 * chain so Eden Treaty can infer end-to-end types in `apps/web` (CLAUDE.md).
 */
export const event = new Elysia({ prefix: '/api/events', tags: ['events'] })
  .model(EventModel)
  .get('/', () => EventService.list(), {
    response: { 200: t.Array(EventModel.event) },
    detail: { summary: 'List events' },
  })
