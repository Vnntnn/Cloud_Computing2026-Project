// Ticket issuing shared by apps/registration (free tickets, approvals) and apps/payment (the
// Stripe webhook, refunds): which enrollments and seat holds take seats, confirming or
// cancelling an enrollment, mailing its tickets, what a refund gives back, and announcing seat
// changes to the live feed.
// See docs/tickets.md for the enrollment lifecycle.
export {
  activeEnrollment,
  activeHold,
  confirmEnrollment,
  effectiveStatus,
  invitationTaken,
  markCancelled,
  markConfirmed,
  seatsTaken,
  type Tx,
} from "./enrollment";
export { AnotherPaymentAccepted, EnrollmentClosed, EnrollmentNotFound, OverLimit, SoldOut } from "./errors";
export { accountLink, appUrl, registeredEmails } from "./mail";
export { dispatchTicketMails, resumeTicketMails, sendTicketMails } from "./outbox";
export { dispatchNotifications, queueNotifications, resumeNotifications, type Notification } from "./notifications";
export { refundSatang, refundTerms } from "./refund";
export { announceSeats, SEATS_CHANNEL } from "./seats";

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

/** A 10-character ticket code (50 random bits), what the ticket's QR code holds. */
export function ticketCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
}
