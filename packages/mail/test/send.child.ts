// One enqueueMail call in its own process (the queue client reads its endpoint from the environment when it is imported):
// prints how it ended as one JSON line. Run by send.test.ts; not a test itself.
import { enqueueMail } from "../src/index";

const timeoutMs = process.env.CHILD_TIMEOUT_MS ? Number(process.env.CHILD_TIMEOUT_MS) : undefined;
const started = Date.now();
const message = { to: "someone@example.com", template: "reset-password", props: { url: "https://example.test/secret-link" } } as const;
try {
  await enqueueMail(message, timeoutMs === undefined ? undefined : { timeoutMs });
  console.log(JSON.stringify({ ok: true, ms: Date.now() - started }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, ms: Date.now() - started, name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "" }));
}
process.exit(0);
