import { treaty } from '@elysiajs/eden'
import type { App as EventApp } from '@eventide/event/app'
import type { App as RegistrationApp } from '@eventide/registration/app'
import { getJwt } from './auth'

// End-to-end types straight from each Elysia server — no codegen. The bearer JWT
// is attached per request (auth's own client handles /api/auth).
const config = {
  async onRequest() {
    const jwt = await getJwt()
    if (jwt) return { headers: { authorization: `Bearer ${jwt}` } }
  },
}

export const edenEvent = treaty<EventApp>(window.location.origin, config)
export const edenReg = treaty<RegistrationApp>(window.location.origin, config)
