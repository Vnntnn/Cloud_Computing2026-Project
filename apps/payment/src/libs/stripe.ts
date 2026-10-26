import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";

// secret (sk_live_) and restricted (rk_live_) keys alike
if (/^[a-z]+_live_/.test(secretKey) && process.env.NODE_ENV !== "production") {
  throw new Error("Refusing to use a live Stripe key outside production; use a sandbox key (rk_test_ or sk_test_)");
}

// The placeholder lets the service boot without a key; Stripe calls fail until one is set.
// A call gives up after 20 s (the default is 80) and is retried once: libs/retry.ts leases a payment for longer than its slowest run.
// The SDK keys every POST by itself, so its own retries can't repeat one; the refund adds a key of its own that spans attempts (libs/refund.ts).
export const stripe = new Stripe(secretKey || "sk_test_placeholder", { timeout: 20_000, maxNetworkRetries: 1 });

// Signs the events Stripe posts to /api/payment/webhook. In dev it comes from
// `bun run stripe:listen` (root package.json); unset, every event is refused.
export const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
