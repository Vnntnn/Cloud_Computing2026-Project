import { jwtClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// The bearer plugin's session token (from `set-auth-token`). Kept in
// localStorage — readable by XSS, a documented trade-off for environment parity
// (SYSTEM-DESIGN §5.5).
const BEARER_KEY = 'eventide.bearer'

export const authClient = createAuthClient({
  // Same origin — /api/auth is proxied to auth in dev, fronted by ingress in prod.
  baseURL: window.location.origin,
  plugins: [jwtClient()],
  fetchOptions: {
    auth: {
      type: 'Bearer',
      token: () => localStorage.getItem(BEARER_KEY) ?? '',
    },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token')
      if (token) localStorage.setItem(BEARER_KEY, token)
    },
  },
})

// event / registration verify the JWT (not the session token) against auth's
// JWKS. Fetch it via the jwt plugin and cache until ~1 min before it expires.
let jwtCache: { token: string; expMs: number } | null = null

function jwtExpMs(jwt: string): number {
  try {
    const part = jwt.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? ''
    return (JSON.parse(atob(part)).exp ?? 0) * 1000
  } catch {
    return 0
  }
}

export async function getJwt(): Promise<string | null> {
  if (jwtCache && jwtCache.expMs - Date.now() > 60_000) return jwtCache.token
  if (!localStorage.getItem(BEARER_KEY)) return null
  const { data } = await authClient.token()
  if (!data?.token) return null
  jwtCache = { token: data.token, expMs: jwtExpMs(data.token) }
  return data.token
}

export function signOut() {
  localStorage.removeItem(BEARER_KEY)
  jwtCache = null
  return authClient.signOut()
}
