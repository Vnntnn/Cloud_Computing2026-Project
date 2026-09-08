import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../env.ts'

/**
 * Presigned S3 URLs for cover images (SYSTEM-DESIGN §12) — the browser PUTs the
 * bytes straight to S3 and reads them straight from S3; nothing streams through
 * a pod. Credentials come from the standard AWS env chain (§5.3).
 *
 * `s3Enabled` is false when no bucket is configured — the cover-upload route
 * then 501s and events just have no image (fine for local dev / the Swagger demo).
 */
export const s3Enabled = Boolean(env.S3_BUCKET_NAME)

const client = s3Enabled ? new S3Client({ region: env.S3_REGION }) : null

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function coverKeyFor(eventId: string, contentType: string): string | null {
  if (!ALLOWED.has(contentType)) return null
  return `events/${eventId}/cover.${EXT[contentType]}`
}

export function imageKeyFor(eventId: string, imageId: string, contentType: string): string | null {
  if (!ALLOWED.has(contentType)) return null
  return `events/${eventId}/${imageId}.${EXT[contentType]}`
}

/** 5-minute URL the browser uses to upload one cover image. */
export function presignPut(key: string, contentType: string): Promise<string> {
  if (!client) throw new Error('S3 not configured')
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  )
}

/** 1-hour URL for `<img src>` on the event page. */
export function presignGet(key: string): Promise<string> {
  if (!client) throw new Error('S3 not configured')
  return getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }), {
    expiresIn: 3600,
  })
}

export async function deleteObject(key: string): Promise<void> {
  if (!client) throw new Error('S3 not configured')
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }))
}
