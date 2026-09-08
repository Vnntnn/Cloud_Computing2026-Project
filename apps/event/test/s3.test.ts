import { describe, expect, it } from 'bun:test'

const { coverKeyFor, imageKeyFor, presignPut, presignGet, s3Enabled } = await import(
  '../src/lib/s3.ts'
)

describe('s3 cover images', () => {
  it('is enabled when a bucket is configured', () => {
    expect(s3Enabled).toBe(true)
  })

  it('maps content types to a stable per-event key, rejects others', () => {
    expect(coverKeyFor('abc', 'image/png')).toBe('events/abc/cover.png')
    expect(coverKeyFor('abc', 'image/jpeg')).toBe('events/abc/cover.jpg')
    expect(coverKeyFor('abc', 'application/pdf')).toBeNull()
    expect(imageKeyFor('abc', 'image-1', 'image/webp')).toBe('events/abc/image-1.webp')
    expect(imageKeyFor('abc', 'image-1', 'application/pdf')).toBeNull()
  })

  it('presigns a PUT URL — bucket host, key path, sigv4 params, short expiry', async () => {
    const url = new URL(await presignPut('events/e1/cover.png', 'image/png'))
    expect(url.host).toBe('eventide-uploads-test.s3.us-east-1.amazonaws.com')
    expect(url.pathname).toBe('/events/e1/cover.png')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
  })

  it('presigns a GET URL with a 1-hour expiry', async () => {
    const url = new URL(await presignGet('events/e1/cover.png'))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })
})
