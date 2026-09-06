import type { Ticket } from './model.ts'

/**
 * Business logic, decoupled from Elysia (SYSTEM-DESIGN §12.2).
 *
 * TODO(week3): `registration` OWNS and enforces capacity by counting its own
 * `tickets` rows in one local transaction (§4.3) — no distributed transaction.
 * "My tickets" is enriched by calling `event` in-cluster, server-side (§4.4).
 */
export abstract class RegistrationService {
  static listMine(_userId: string): Ticket[] {
    return []
  }
}
