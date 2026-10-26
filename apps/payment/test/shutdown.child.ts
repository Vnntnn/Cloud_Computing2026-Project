// A payment service for shutdown.test.ts: the real scheduler (scoped to the orders it is given) and the real shutdown handler,
// on an Elysia server with one controllable slow route standing in for a request that is in the middle of its work.
// Not a test itself.
import { Elysia } from "elysia";
import { startReconciler } from "../src/libs/reconcile";
import { installShutdown } from "../src/shutdown";

let inFlight = 0;
let completed = 0;
const release = Bun.file(process.env.RELEASE_FILE!);
const app = new Elysia()
  .get("/ping", () => "ok")
  .get("/state", () => ({ inFlight, completed }))
  .get("/slow", async () => {
    inFlight++;
    while (!(await release.exists())) await Bun.sleep(20);
    inFlight--;
    completed++;
    return "done";
  });
app.listen(Number(process.env.PORT));
const stopReconciler = startReconciler({ intervalMs: 150, only: process.argv.slice(2) });
installShutdown([() => stopReconciler(), async () => void (await app.stop())]);
console.log("ready");
