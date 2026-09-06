import { t } from 'elysia'

/**
 * Placeholder models for the auth module.
 *
 * TODO(week2): better-auth mounts `/api/auth/*` and owns its own request
 * handling — most of what lives here will be the JWT-claim shape shared with
 * `event` / `registration`, not hand-written sign-in bodies.
 */
export const AuthModel = {
  session: t.Object({
    userId: t.String(),
    email: t.String({ format: 'email' }),
  }),
}

export type Session = typeof AuthModel.session.static
