import { HTTPError } from "elysia";

export class EnrollmentNotFound extends HTTPError.id("ENROLLMENT_NOT_FOUND", 404) {
  override readonly detail = "ไม่พบรายการลงทะเบียนนี้";
}

/** No seats left for the tickets asked for, or (after a lapsed hold) the invitation was used meanwhile. */
export class SoldOut extends HTTPError.id("SOLD_OUT", 409) {
  override readonly detail = "ตั๋วประเภทนี้เต็มแล้ว";
}

/** Rejected by the organizer, or the payment hold ran out. */
export class EnrollmentClosed extends HTTPError.id("ENROLLMENT_CLOSED", 409) {
  override readonly detail = "รายการลงทะเบียนนี้ถูกปฏิเสธหรือหมดเวลาชำระเงินแล้ว";
}

/**
 * A lapsed hold's order that would take its buyer past the ticket type's `max_per_user`, because they
 * ordered again after the hold ran out. Whether to honour or refund such a payment is the owner's call.
 */
export class OverLimit extends HTTPError.id("OVER_LIMIT", 409) {
  override readonly detail = "การลงทะเบียนนี้จะทำให้ผู้ซื้อมีตั๋วเกินจำนวนสูงสุดต่อบัญชี";
}

/** The order was already confirmed by another payment: this one paid for it a second time. */
export class AnotherPaymentAccepted extends HTTPError.id("ANOTHER_PAYMENT_ACCEPTED", 409) {
  override readonly detail = "รายการนี้ยืนยันด้วยการชำระเงินอื่นแล้ว";
}
