import type { EventShape } from './model.ts'

/**
 * Business logic, decoupled from Elysia (SYSTEM-DESIGN §12.2). Pure, static,
 * framework-agnostic — trivially testable.
 *
 * TODO(week2): read/write `event_db` through `@eventide/db`, add S3 presigned
 * cover-image upload.
 */
export abstract class EventService {
  static list(): EventShape[] {
    return []
  }
}
