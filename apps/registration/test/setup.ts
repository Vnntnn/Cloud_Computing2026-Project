/**
 * bun test preload (see bunfig.toml). Runs once, before any test file imports
 * the service `app`, so `src/env.ts` reads these fixture URLs instead of the
 * localhost defaults:
 *   - AUTH_JWKS_URL  -> a throwaway JWKS endpoint (real bearerAuth guard runs)
 *   - EVENT_SERVICE_URL -> `eventService`, a controllable stub for the event peer
 */
import { fakeService, installAuthFixture } from '@eventide/shared/testing'

await installAuthFixture()

export const eventService = fakeService()
process.env.EVENT_SERVICE_URL = eventService.url
