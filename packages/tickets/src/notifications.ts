import { dispatchNotifications as dispatch, queueNotifications as queue, resumeNotifications, type Notification as Recorded } from "@app/db";
import { enqueueMail, type MailMessage } from "@app/mail";
import type { Tx } from "./enrollment";

// The mail that follows a state change other than a confirmation (tickets have their own outbox, outbox.ts): a refund recorded,
// an order cancelled by it, a refund that failed or was cancelled, an enrollment approved or rejected. The delivery (recording
// in the transaction, sending after the commit, leases, backoff, stale-state checks) is shared with apps/auth and apps/event
// and lives in @app/db (notifications.ts); this binds it to the mail queue and types the message.

export type Notification = Omit<Recorded, "message"> & { message: MailMessage };

/** Records the mails owed for a change, in the transaction that makes it. */
export const queueNotifications = (tx: Tx | Parameters<typeof queue>[0], notifications: Notification[]) => queue(tx, notifications);

/** Sends the mails that are owed (all of them, or those of one enrollment). Never throws. */
export const dispatchNotifications = (scope: { enrollmentId?: string; limit?: number; halt?: () => boolean } = {}) => dispatch(enqueueMail, scope);

export { resumeNotifications };
