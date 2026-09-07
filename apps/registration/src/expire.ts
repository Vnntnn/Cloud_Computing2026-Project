import { RegistrationService } from './modules/registration/service.ts'

/**
 * One-shot reservation-expiry sweep — runs as a Kubernetes CronJob every minute
 * (`concurrencyPolicy: Forbid`, `restartPolicy: Never`). The Drizzle/postgres.js
 * pool keeps the event loop alive, so this must exit explicitly or the Job never
 * completes and every later run is skipped.
 */
try {
  const count = await RegistrationService.expire()
  console.log(`expired ${count} pending orders`)
  process.exit(0)
} catch (err) {
  console.error('expiry sweep failed:', err)
  process.exit(1)
}
