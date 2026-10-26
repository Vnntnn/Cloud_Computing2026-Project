import type { MailTemplate, MailTemplates } from "@app/mail";
import type { ComponentType } from "react";
import { render, toPlainText } from "react-email";
import { MailAssets } from "../emails/_components/assets";
import * as enrollmentApproved from "../emails/enrollment-approved";
import * as enrollmentRejected from "../emails/enrollment-rejected";
import * as eventInvitation from "../emails/event-invitation";
import * as orderCancelled from "../emails/order-cancelled";
import * as organizerApproved from "../emails/organizer-approved";
import * as organizerRejected from "../emails/organizer-rejected";
import * as refundCanceled from "../emails/refund-canceled";
import * as refundFailed from "../emails/refund-failed";
import * as refundSystem from "../emails/refund-system";
import * as resetPassword from "../emails/reset-password";
import * as ticket from "../emails/ticket";
import * as ticketCancelled from "../emails/ticket-cancelled";

type Template<K extends MailTemplate> = {
  default: ComponentType<MailTemplates[K]>;
  subject: (props: MailTemplates[K]) => string;
};

/** Every template in emails/, by the name producers put on the queue. */
export const templates: { [K in MailTemplate]: Template<K> } = {
  "reset-password": resetPassword,
  "organizer-approved": organizerApproved,
  "organizer-rejected": organizerRejected,
  "event-invitation": eventInvitation,
  ticket,
  "enrollment-approved": enrollmentApproved,
  "enrollment-rejected": enrollmentRejected,
  "refund-system": refundSystem,
  "order-cancelled": orderCancelled,
  "ticket-cancelled": ticketCancelled,
  "refund-failed": refundFailed,
  "refund-canceled": refundCanceled,
};

// The logo goes inline with every mail, so it shows without loading anything (even from localhost).
const logoCid = "logo@eventide";
const logo = { filename: "eventide.png", path: `${import.meta.dir}/../emails/static/logo.png`, cid: logoCid };

/**
 * The subject, HTML and plain text of a queued mail, plus the attachments its HTML refers to;
 * null when the template doesn't exist. Throws when the props don't fit the template.
 */
export async function renderMail<K extends MailTemplate>({ template, props }: { template: K; props: MailTemplates[K] }) {
  if (!Object.hasOwn(templates, template)) return null;
  const { default: Email, subject } = templates[template];
  const html = await render(
    <MailAssets value={{ logo: `cid:${logoCid}` }}>
      <Email {...props} />
    </MailAssets>,
  );
  return { subject: subject(props), html, text: toPlainText(html), attachments: [logo] };
}
