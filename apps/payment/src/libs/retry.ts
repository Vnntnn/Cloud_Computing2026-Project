// How long recovery leaves a payment (or refund intent) alone after taking it up, and how fast it backs off after failing.
// The state lives in the rows (recovery_attempts, recovery_next_at, recovery_hold), so it survives restarts and is shared by replicas.

/** The slowest a settlement runs: three Stripe calls, each 20 s with one retry (libs/stripe.ts), plus the database. */
export const LEASE_MS = 10 * 60_000;
/** Attempts before a payment is held for a person (`exhausted`): about two hours of retrying. */
export const MAX_ATTEMPTS = 6;

/** 2, 4, 8, … minutes after the nth failed attempt, at most an hour. */
export const backoffMs = (attempts: number) => Math.min(2 ** attempts * 60_000, 60 * 60_000);
