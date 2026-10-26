// The data each mail template renders (apps/mail-worker/emails/<name>.tsx). Producers send raw
// values: the templates escape them, format dates in Thailand's zone and pick the wording.
// Messages travel as JSON, so dates are ISO strings.

export type MailEvent = { title: string; venue: string; startsAt: string };

/** An enrollment: `quantity` tickets of one type. */
export type MailOrder = { event: MailEvent; ticketType: string; quantity: number };

export type MailTemplates = {
  "reset-password": { url: string };
  "organizer-approved": { name: string; organizationName: string; url: string };
  "organizer-rejected": { name: string; organizationName: string; note: string | null; url: string };
  /** `name`: the invitee's account name, or null when they have no account yet (they're asked to sign up). */
  "event-invitation": { name: string | null; email: string; event: MailEvent; url: string };
  /** One attendee's ticket. `hasAccount`: whether `email` is registered, so they sign in rather than up. */
  ticket: {
    name: string;
    email: string;
    ticketType: string;
    event: MailEvent;
    code: string;
    url: string;
    hasAccount: boolean;
  };
  /** A paid approval enrollment, now waiting for payment until `payBy`. */
  "enrollment-approved": { name: string | null; order: MailOrder; payBy: string; url: string };
  "enrollment-rejected": { name: string | null; order: MailOrder; reason: string | null };
  /**
   * A payment the system refunded in full: it paid the order twice (duplicate), or landed after its
   * hold lapsed and the seats went (unavailable). `manual`: refunded by hand, so the buyer has to
   * send `orderNumber` and their bank account.
   */
  "refund-system": {
    name: string | null;
    reason: "duplicate" | "unavailable";
    order: MailOrder;
    amount: number;
    manual: boolean;
    orderNumber: string;
  };
  /** To the buyer: their order was cancelled and `amount` (`percent` of `total`) comes back. */
  "order-cancelled": {
    name: string | null;
    byOrganizer: boolean;
    note: string | null;
    order: MailOrder;
    amount: number;
    percent: number;
    total: number;
    manual: boolean;
    orderNumber: string;
    url: string;
  };
  /** To an attendee who isn't the buyer: their ticket no longer works. */
  "ticket-cancelled": { name: string; buyerName: string | null; order: MailOrder };
  /** Stripe couldn't return the money. */
  "refund-failed": { name: string | null; order: MailOrder; amount: number; url: string };
  /** Stripe cancelled the refund, so the money was not returned. */
  "refund-canceled": { name: string | null; order: MailOrder; amount: number; url: string };
};

export type MailTemplate = keyof MailTemplates;
