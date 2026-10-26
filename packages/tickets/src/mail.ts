import { db, inArray, users } from "@app/db";

/** The browser-facing origin, for links in mail. */
export const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";

/** A same-site link, or the sign-up page that leads to it when nobody has registered `email` yet. */
export const accountLink = (path: string, hasAccount: boolean) =>
  hasAccount ? `${appUrl}${path}` : `${appUrl}/register?redirect=${encodeURIComponent(path)}`;

/** The registered accounts among `emails` (lowercase), so mail can say "sign in" or "sign up". */
export async function registeredEmails(emails: string[]) {
  if (emails.length === 0) return new Set<string>();
  const rows = await db.select({ email: users.email }).from(users).where(inArray(users.email, emails));
  return new Set(rows.map((row) => row.email));
}
