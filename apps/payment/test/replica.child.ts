// One "replica" of the payment service's reconciler, run as its own process by reliability.test.ts: recovers the orders it is given
// and prints what it did as one JSON line. Not a test itself.
import { reconcilePaid } from "../src/libs/reconcile";

const report = await reconcilePaid({ only: process.argv.slice(2) });
console.log(JSON.stringify(report));
process.exit(0);
