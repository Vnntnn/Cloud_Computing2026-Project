import { describe, expect, it } from 'bun:test'

// Fake creds + a bucket name BEFORE importing the module — the S3 client reads
// the env at construction. No network: getSignedUrl is pure crypto.
process.env.S3_BUCKET_NAME = 'eventide-uploads-test'
process.env.S3_REGION = 'us-east-1'
process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

const { coverKeyFor, presignPut, presignGet, s3Enabled } = await import('../src/lib/s3.ts')

describe('s3 cover images', () => {
  it('is enabled when a bucket is configured', () => {
    expect(s3Enabled).toBe(true)
  })

  it('maps content types to a stable per-event key, rejects others', () => {
    expect(coverKeyFor('abc', 'image/png')).toBe('events/abc/cover.png')
    expect(coverKeyFor('abc', 'image/jpeg')).toBe('events/abc/cover.jpg')
    expect(coverKeyFor('abc', 'application/pdf')).toBeNull()
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
