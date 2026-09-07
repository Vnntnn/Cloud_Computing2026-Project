import { timingSafeEqual } from 'node:crypto'

export function internalTokenMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false
  const actual = Buffer.from(received)
  const target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}
