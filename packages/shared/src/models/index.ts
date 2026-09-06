import { t } from 'elysia'

/**
 * Shared request/response models — Elysia `t` (TypeBox) only.
 *
 * Register these on a service via `.model({ ... })` and reference them by name so
 * they show up once in the OpenAPI document and keep Eden inference fast.
 *
 * TODO (week 2+): JWT claim shape (`sub`, `email`), the cross-service event DTO
 * that `registration` receives from `event`, and the paginated-list envelope.
 */

/** Uniform error body returned by every service. */
export const ErrorResponse = t.Object({
  error: t.String(),
  message: t.String(),
})
export type ErrorResponse = typeof ErrorResponse.static

/** `/health/*` payload. */
export const HealthResponse = t.Object({
  status: t.Union([t.Literal('ok'), t.Literal('degraded')]),
  service: t.String(),
})
export type HealthResponse = typeof HealthResponse.static
