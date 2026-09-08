export type AccessArea = 'authenticated' | 'organizer' | 'admin'
export type AccessDecision = 'allow' | 'login' | 'profile' | 'home'

type AccessUser = {
  id?: string
  role?: string
  organizerApprovalStatus?: string
}

export function accessDecision(
  user: AccessUser | null | undefined,
  area: AccessArea,
): AccessDecision {
  if (!user) return 'login'
  if (area === 'authenticated') return 'allow'
  if (area === 'admin') return user.role === 'admin' ? 'allow' : 'home'
  if (user.role === 'admin') return 'allow'
  return user.role === 'organizer' && user.organizerApprovalStatus === 'APPROVED'
    ? 'allow'
    : 'profile'
}
