/**
 * `auth_db` is owned entirely by better-auth.
 *
 * Do NOT hand-write its schema. The Drizzle adapter plus the JWT plugin generate
 * `user`, `session`, `account`, `verification`, and `jwks`. Generate migrations
 * with the better-auth CLI (`bunx @better-auth/cli generate`) and run them through
 * the same migration Job as the other two services (SYSTEM-DESIGN §4.2).
 *
 * This file is intentionally a placeholder so the shape of `packages/db` is
 * consistent across services. It will re-export better-auth's generated schema
 * once the `auth` service is wired up in week 2.
 */
export {}
