import { describe, expect, it } from 'bun:test'
import { coverFileError, uploadEventCover } from '../src/lib/event-cover.ts'

describe('event cover uploads', () => {
  it('accepts the image types supported by the event API', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(
        coverFileError(new File(['image'], `cover.${type.split('/')[1]}`, { type })),
      ).toBeNull()
    }
  })

  it('rejects unsupported and empty files', () => {
    expect(coverFileError(new File(['data'], 'cover.gif', { type: 'image/gif' }))).toBe(
      'Choose a JPEG, PNG, or WebP image.',
    )
    expect(coverFileError(new File([], 'cover.png', { type: 'image/png' }))).toBe(
      'Choose a non-empty image file.',
    )
  })

  it('presigns and uploads the file with its content type', async () => {
    const file = new File(['image'], 'cover.png', { type: 'image/png' })
    let presignedType = ''
    let requestInput: string | URL | Request = ''
    let requestInit: RequestInit | undefined

    await uploadEventCover(
      file,
      async (contentType) => {
        presignedType = contentType
        return { uploadUrl: 'https://uploads.example/cover.png' }
      },
      async (input, init) => {
        requestInput = input
        requestInit = init
        return new Response(null, { status: 200 })
      },
    )

    expect(presignedType).toBe('image/png')
    expect(requestInput).toBe('https://uploads.example/cover.png')
    expect(requestInit?.method).toBe('PUT')
    expect(requestInit?.headers).toEqual({ 'content-type': 'image/png' })
    expect(requestInit?.body).toBe(file)
  })

  it('reports presign and S3 failures', async () => {
    const file = new File(['image'], 'cover.webp', { type: 'image/webp' })

    await expect(uploadEventCover(file, async () => null)).rejects.toThrow(
      'Could not prepare the thumbnail upload.',
    )
    await expect(
      uploadEventCover(
        file,
        async () => ({ uploadUrl: 'https://uploads.example/cover.webp' }),
        async () => new Response(null, { status: 403 }),
      ),
    ).rejects.toThrow('The thumbnail upload failed.')
  })
})
