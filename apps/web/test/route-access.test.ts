import { describe, expect, it } from 'bun:test'
import { accessDecision } from '../src/lib/route-access.ts'

describe('pathless route access', () => {
  it('sends anonymous visitors to login for every protected area', () => {
    expect(accessDecision(null, 'authenticated')).toBe('login')
    expect(accessDecision(null, 'organizer')).toBe('login')
    expect(accessDecision(null, 'admin')).toBe('login')
  })

  it('allows any signed-in account through attendee routes', () => {
    expect(accessDecision({ role: 'attendee' }, 'authenticated')).toBe('allow')
  })

  it('allows only approved organizers or admins through organizer routes', () => {
    expect(
      accessDecision({ role: 'organizer', organizerApprovalStatus: 'APPROVED' }, 'organizer'),
    ).toBe('allow')
    expect(
      accessDecision({ role: 'organizer', organizerApprovalStatus: 'PENDING' }, 'organizer'),
    ).toBe('profile')
    expect(accessDecision({ role: 'attendee' }, 'organizer')).toBe('profile')
    expect(accessDecision({ role: 'admin' }, 'organizer')).toBe('allow')
  })

  it('allows only admins through admin routes', () => {
    expect(accessDecision({ role: 'admin' }, 'admin')).toBe('allow')
    expect(accessDecision({ role: 'organizer' }, 'admin')).toBe('home')
    expect(accessDecision({ role: 'attendee' }, 'admin')).toBe('home')
  })
})
