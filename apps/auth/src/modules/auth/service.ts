/**
 * Business logic, decoupled from Elysia (SYSTEM-DESIGN §12.2).
 *
 * TODO(week2): mount better-auth (Drizzle adapter + JWT plugin + bearer plugin),
 * enable Google OAuth *and* email/password, expose `/api/auth/jwks`.
 */
export abstract class AuthService {
  static placeholder(): string {
    return 'auth service — not yet wired'
  }
}
