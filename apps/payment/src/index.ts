import { payment } from "./app";
import { startReconciler } from "./libs/reconcile";
import { installShutdown } from "./shutdown";

export { payment };
export type { Payment } from "./app";

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3004);
  payment.listen(port);
  console.log(`Payment service is runing on : http://localhost:${port}`);
  let stopReconciler = async () => {};
  // Off in dev: the dev database is shared with the tests, which strand payments on purpose. The pods run with NODE_ENV=production.
  if (process.env.NODE_ENV === "production") {
    stopReconciler = startReconciler();
    console.log("Payment reconciler is finishing paid orders left unconfirmed, every minute");
  } else console.log("Payment reconciler is off outside production");
  // see shutdown.ts: the pod's grace period is for this
  installShutdown([() => stopReconciler(), async () => void (await payment.stop())]);
}
