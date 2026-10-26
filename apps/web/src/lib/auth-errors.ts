import { t, type MessageKey } from "@/i18n";
import { shared } from "@/i18n/messages/shared";

// Better Auth error codes (API responses) and OAuth redirect codes (`?error=` on /login); the texts are in shared.authErrors.
const codes = new Set<string>([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_EMAIL",
  "INVALID_PASSWORD",
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "BANNED_USER",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "SESSION_EXPIRED",
  "CREDENTIAL_ACCOUNT_NOT_FOUND",
  "FAILED_TO_UNLINK_LAST_ACCOUNT",
  "SOCIAL_ACCOUNT_ALREADY_LINKED",
  "LINKED_ACCOUNT_ALREADY_EXISTS",
  "YOU_CANNOT_BAN_YOURSELF",
  "ORGANIZER_HAS_EVENTS",
  "account_not_linked",
  "account_already_linked_to_different_user",
  "email_does_not_match",
  "access_denied",
]);

const fallback = () => t("shared.authErrors.fallback");

/** Accepts a code string or anything with a `code` (Better Auth client errors, thrown mutation errors). */
export function authErrorMessage(error: unknown) {
  const code =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
  if (code && codes.has(code)) return t(`shared.authErrors.${code}` as MessageKey);
  // Better Auth's rate limiter answers 429 without a code
  if (error && typeof error === "object" && "status" in error && error.status === 429) return t("shared.authErrors.rateLimited");
  return fallback();
}

// every code the services can answer with has its text in shared.problems, in both languages
const problemCodes = new Set<string>(Object.keys(shared.th.problems));

/**
 * Message of an Eden error, in the current language. Our services return problem documents with a stable `code` and a
 * Thai-only `detail`, so the text is looked up by `code` and `detail` is never shown. Unknown codes get the generic message.
 */
export function problemMessage(error: unknown) {
  const value = error && typeof error === "object" && "value" in error ? error.value : undefined;
  const code = value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : undefined;
  return code && problemCodes.has(code) ? t(`shared.problems.${code}` as MessageKey) : fallback();
}
