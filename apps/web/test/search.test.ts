import { describe, expect, it } from 'bun:test'
import { eventsSearchSchema } from '../src/lib/search.ts'

describe('event search parameters', () => {
  it('coerces valid pagination values and preserves filters', () => {
    expect(
      eventsSearchSchema.parse({
        q: 'cloud',
        category: 'technology',
        province: 'Bangkok',
        page: '3',
        pageSize: '40',
      }),
    ).toEqual({
      q: 'cloud',
      category: 'technology',
      province: 'Bangkok',
      page: 3,
      pageSize: 40,
    })
  })

  it('falls back safely for invalid or out-of-range pagination', () => {
    expect(eventsSearchSchema.parse({ page: '-2', pageSize: '500' })).toEqual({
      page: 1,
      pageSize: 20,
    })
  })
})
