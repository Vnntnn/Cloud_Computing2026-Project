import { authentication } from "./app";
import { startResetMailRecovery } from "./libs/reset-mail-recovery";

export { authentication };
export type { Authentication } from "./app";

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  authentication.listen(port);
  console.log(`Auth service is runing on : http://localhost:${port}`);
  // Off in dev, like the payment scheduler: the dev database is shared with the tests. The pods run with NODE_ENV=production.
  if (process.env.NODE_ENV === "production") {
    let stopRecovery = async () => {};
    void startResetMailRecovery()
      .then((stop) => (stopRecovery = stop))
      .catch((error) => console.error("Password reset mail recovery did not start", error instanceof Error ? error.name : "unknown"));
    // on SIGTERM: no new recovery pass, requests in flight finish, then exit (what a kill leaves is an outbox row the next pod sends)
    let closing = false;
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, async () => {
        if (closing) process.exit(1);
        closing = true;
        await Promise.all([stopRecovery(), authentication.stop()]);
        process.exit(0);
      });
    }
  }
}
