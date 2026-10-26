import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { MailTemplate, MailTemplates } from "./templates";

export type * from "./templates";

/** What a mail says: one of the templates in apps/mail-worker/emails, with its props. */
export type MailContent = {
  [K in MailTemplate]: { template: K; props: MailTemplates[K] };
}[MailTemplate];

export type MailMessage = { to: string } & MailContent;

export const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.SQS_ENDPOINT,
});

export const mailQueueUrl = process.env.MAIL_QUEUE_URL!;

// A queue that stops answering must fail the send (every caller retries it through the outbox or logs it), not hold a request, a
// webhook or a shutdown. The SDK honours the abort signal, including across its own retries: the whole call ends at the timeout.
export const SEND_TIMEOUT_MS = 10_000;

export async function enqueueMail(message: MailMessage, { timeoutMs = SEND_TIMEOUT_MS }: { timeoutMs?: number } = {}) {
  await sqs.send(
    new SendMessageCommand({ QueueUrl: mailQueueUrl, MessageBody: JSON.stringify(message) }),
    { abortSignal: AbortSignal.timeout(timeoutMs) },
  );
}

/** The message's shape only: whether `template` exists is up to the worker that renders it. */
export function parseMailMessage(body: string | undefined): MailMessage | null {
  try {
    const value = JSON.parse(body ?? "");
    if (typeof value?.to !== "string" || typeof value?.template !== "string") return null;
    if (typeof value.props !== "object" || value.props === null) return null;
    return value;
  } catch {
    return null;
  }
}
