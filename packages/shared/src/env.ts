import type { z } from 'zod'

/**
 * Boot-time environment validation. Zod is deliberately confined to this path —
 * request models are Elysia `t` / TypeBox only (see CLAUDE.md).
 *
 * Call once at process start, before constructing the Elysia app, so a missing
 * injected secret fails with a clear message instead of a mystery crash later.
 */
export function defineEnv<T extends z.ZodType>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${issues}`)
  }

  return parsed.data
}
