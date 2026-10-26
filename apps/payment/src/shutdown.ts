/**
 * What a pod does with SIGTERM (its grace period is in infra/helm values.yaml): every `stop` runs at once (the scheduler stops
 * after the record it is on, the server stops taking requests and lets the ones in flight finish), then the process exits 0.
 * A second signal, or a stop that throws, exits 1 at once. What a kill leaves half done is an intent, a lease or an outbox row
 * that the next process picks up.
 */
export function installShutdown(stops: (() => Promise<unknown>)[], exit: (code: number) => void = (code) => process.exit(code)) {
  let closing = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
      if (closing) return exit(1);
      closing = true;
      try {
        await Promise.all(stops.map((stop) => stop()));
      } catch (error) {
        console.error("Shutdown failed", error instanceof Error ? error.name : "unknown");
        return exit(1);
      }
      exit(0);
    });
  }
}
