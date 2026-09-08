export const coverContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

export type CoverContentType = (typeof coverContentTypes)[number]

type PresignCover = (
  contentType: CoverContentType,
) => Promise<{ uploadUrl: string } | null | undefined>

const isCoverContentType = (contentType: string): contentType is CoverContentType =>
  coverContentTypes.some((allowed) => allowed === contentType)

export function coverFileError(file: File | null): string | null {
  if (!file) return null
  if (file.size === 0) return 'Choose a non-empty image file.'
  if (!isCoverContentType(file.type)) return 'Choose a JPEG, PNG, or WebP image.'
  return null
}

export async function uploadEventCover(
  file: File,
  presign: PresignCover,
  request: typeof fetch = fetch,
) {
  const validationError = coverFileError(file)
  if (validationError) throw new Error(validationError)

  const prepared = await presign(file.type as CoverContentType)
  if (!prepared?.uploadUrl) throw new Error('Could not prepare the thumbnail upload.')

  const response = await request(prepared.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  })
  if (!response.ok)
    throw new Error('The thumbnail upload failed. Try again or continue without it.')
}
