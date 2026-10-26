import { dispatchNotifications, ensureEpoch, recordMissingResetMails } from "@app/db";
import { enqueueMail } from "@app/mail";

// Password-reset mail that better-auth's two steps (store the token, then call us) could lose: this process declares the epoch from
// which it accounts for every token (packages/db notifications.ts), then every minute records the unrecorded ones and sends what is
// owed. Replicas may all run it: the outbox keys and leases keep a mail to one. Production only (the pods; NODE_ENV): in dev the
// database is shared with tests, and nobody should be mailed from it. The payment service's reconciler does the same scan too.
export async function startResetMailRecovery({ intervalMs = 60_000, epochName = "reset-password", only }: { intervalMs?: number; epochName?: string; only?: string[] } = {}) {
  await ensureEpoch(epochName);
  let running = false;
  let stopping = false;
  const pass = async () => {
    if (running || stopping) return;
    running = true;
    try {
      // every pass: the epoch (a deleted one is written again rather than leaving the scan silent), what a crash left unrecorded, and
      // everything owed, so a reset mail that failed to send is retried here too, not only when the payment service runs
      await ensureEpoch(epochName);
      await recordMissingResetMails({ epochName, verificationIds: only });
      // `only` (tests) narrows both to some tokens: the loop is otherwise for everything that is owed
      await dispatchNotifications((message) => enqueueMail(message), { halt: () => stopping, subjectIds: only });
    } catch (error) {
      console.error("Password reset mail recovery failed", error instanceof Error ? error.name : "unknown");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  void pass();
  // no new pass, and resolves once the one in progress is done
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (running) await Bun.sleep(100);
  };
}
