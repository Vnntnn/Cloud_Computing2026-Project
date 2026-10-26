import { afterAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { SEND_TIMEOUT_MS } from "../src/index";

// enqueueMail against the real AWS SDK client and a real HTTP peer:
//   - a queue that never answers (a local server that accepts the request and stays silent: not SQS, but exactly what a black-holed
//     queue looks like to the client), to see the timeout end the call as a failure;
//   - ElasticMQ, the SQS-compatible server in docker-compose, on a queue made for the test (never the mail queue), for a send that works.
// Neither is AWS SQS. The client reads its endpoint when imported, so each call runs in its own process.
const child = new URL("./send.child.ts", import.meta.url).pathname;
const ELASTICMQ = process.env.SQS_ENDPOINT ?? "http://localhost:9324";

async function sendInChild(env: Record<string, string>) {
  const proc = Bun.spawn(["bun", child], {
    env: { ...process.env, AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "x", AWS_SECRET_ACCESS_KEY: "x", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout as ReadableStream).text();
  const err = await new Response(proc.stderr as ReadableStream).text();
  await proc.exited;
  return { result: JSON.parse(out.trim().split("\n").pop()!) as { ok: boolean; ms: number; name?: string; message?: string }, stderr: err };
}

const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
afterAll(() => silent.stop(true));

describe("a queue that never answers", () => {
  test("the send fails at the timeout it was given, as an error, and does not hang", async () => {
    const { result, stderr } = await sendInChild({
      SQS_ENDPOINT: `http://127.0.0.1:${silent.port}`,
      MAIL_QUEUE_URL: `http://127.0.0.1:${silent.port}/000000000000/mail-queue`,
      CHILD_TIMEOUT_MS: "400",
    });
    expect(result.ok).toBe(false);
    // the whole call, SDK retries included, ended at the timeout (not after the SDK's own, much longer, retries)
    expect(result.ms).toBeGreaterThanOrEqual(350);
    expect(result.ms).toBeLessThan(3000);
    expect(["TimeoutError", "AbortError"]).toContain(result.name ?? "");
    // what the process wrote doesn't carry the message
    expect(stderr).not.toContain("secret-link");
  });

  test("without an explicit timeout it gives up after SEND_TIMEOUT_MS (10 s), not later", async () => {
    expect(SEND_TIMEOUT_MS).toBe(10_000);
    const { result } = await sendInChild({
      SQS_ENDPOINT: `http://127.0.0.1:${silent.port}`,
      MAIL_QUEUE_URL: `http://127.0.0.1:${silent.port}/000000000000/mail-queue`,
    });
    expect(result.ok).toBe(false);
    expect(result.ms).toBeGreaterThanOrEqual(9_500);
    expect(result.ms).toBeLessThan(13_000);
  }, 30_000);
});

describe("a queue that answers (ElasticMQ, SQS-compatible; not AWS SQS)", async () => {
  const sqs = new SQSClient({ region: "us-east-1", endpoint: ELASTICMQ, credentials: { accessKeyId: "x", secretAccessKey: "x" } });
  const name = `phase4-send-probe-${crypto.randomUUID().slice(0, 8)}`;
  let queueUrl: string | undefined;
  try {
    queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: name }), { abortSignal: AbortSignal.timeout(2000) })).QueueUrl;
  } catch {
    queueUrl = undefined;
  }
  afterAll(async () => {
    if (queueUrl) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => {});
  });

  test.skipIf(!queueUrl)("a send completes normally, well inside the timeout, and the queue has the message", async () => {
    const { result } = await sendInChild({ SQS_ENDPOINT: ELASTICMQ, MAIL_QUEUE_URL: queueUrl! });
    expect(result.ok).toBe(true);
    expect(result.ms).toBeLessThan(5_000);
    const received = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl!, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }));
    expect(received.Messages).toHaveLength(1);
    expect(JSON.parse(received.Messages![0]!.Body!)).toMatchObject({ to: "someone@example.com", template: "reset-password" });
  });
});
