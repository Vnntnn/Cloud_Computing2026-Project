import { describe, expect, it } from 'bun:test'
import {
  bangkokDateTimeInputToIso,
  isDateTimeInput,
  toBangkokDateTimeInput,
} from '../src/lib/event-dates.ts'

describe('event date fields', () => {
  it('formats API timestamps as Bangkok-local datetime inputs', () => {
    expect(toBangkokDateTimeInput('2026-10-02T03:30:00.000Z')).toBe('2026-10-02T10:30')
  })

  it('converts Bangkok-local inputs back to UTC timestamps', () => {
    expect(bangkokDateTimeInputToIso('2026-10-02T10:30')).toBe('2026-10-02T03:30:00.000Z')
  })

  it('validates complete local date and time values', () => {
    expect(isDateTimeInput('2026-10-02T10:30')).toBe(true)
    expect(isDateTimeInput('2026-10-02T')).toBe(false)
    expect(isDateTimeInput('2026-02-31T10:30')).toBe(false)
    expect(isDateTimeInput('not-a-date')).toBe(false)
  })
})
