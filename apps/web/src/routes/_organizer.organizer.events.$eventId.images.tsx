import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Images, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { edenEvent } from '@/lib/eden'
import {
  type CoverContentType,
  coverContentTypes,
  coverFileError,
  uploadEventCover,
} from '@/lib/event-cover'
import { eventImagesQuery, eventQuery } from '@/lib/queries'

export const Route = createFileRoute('/_organizer/organizer/events/$eventId/images')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(eventQuery(params.eventId)),
      context.queryClient.ensureQueryData(eventImagesQuery(params.eventId)),
    ]),
  component: EventImagesPage,
})

function EventImagesPage() {
  const { eventId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: event } = useSuspenseQuery(eventQuery(eventId))
  const { data: eventImages } = useSuspenseQuery(eventImagesQuery(eventId))
  const [files, setFiles] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const refreshImages = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['events', eventId, 'images'] }),
      queryClient.invalidateQueries({ queryKey: ['events'] }),
    ])
  }

  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const validationError = selected.map((file) => coverFileError(file)).find(Boolean)
      if (validationError) throw new Error(validationError)
      if (selected.length + eventImages.length > 8)
        throw new Error('An event can have at most eight images.')

      for (const file of selected)
        await uploadEventCover(file, async (contentType: CoverContentType) => {
          const prepared = await edenEvent.api
            .events({ id: eventId })
            .images.presign.post({ contentType, altText: file.name, append: true })
          if (prepared.error || !prepared.data || prepared.data instanceof Response) return null
          return prepared.data
        })
    },
    onSuccess: async () => {
      setFiles([])
      if (inputRef.current) inputRef.current.value = ''
      await refreshImages()
      toast.success('Event images uploaded')
    },
    onError: (error) => toast.error(error.message),
  })

  const reorder = useMutation({
    mutationFn: async (imageIds: string[]) => {
      const { error } = await edenEvent.api
        .events({ id: eventId })
        .images.reorder.patch({ imageIds })
      if (error) throw new Error('The image order could not be saved.')
    },
    onSuccess: async () => {
      await refreshImages()
      toast.success('Image order updated')
    },
    onError: (error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: async (imageId: string) => {
      const { error } = await edenEvent.api.events({ id: eventId }).images({ imageId }).delete()
      if (error) throw new Error('The image could not be deleted.')
    },
    onSuccess: async () => {
      await refreshImages()
      toast.success('Image deleted')
    },
    onError: (error) => toast.error(error.message),
  })

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= eventImages.length) return
    const imageIds = eventImages.map((image) => image.id)
    const currentId = imageIds[index]
    const targetId = imageIds[target]
    if (!currentId || !targetId) return
    imageIds[index] = targetId
    imageIds[target] = currentId
    reorder.mutate(imageIds)
  }

  const busy = upload.isPending || reorder.isPending || remove.isPending

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold">Event images</h1>
          <p className="text-muted-foreground">
            The first image is the cover for {event.title}. Add up to eight images.
          </p>
        </div>
        <Button variant="outline" render={<Link to="/organizer/events" />}>
          Back to events
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add images</CardTitle>
          <CardDescription>
            JPEG, PNG, and WebP files upload directly to object storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="event-images">Choose images</FieldLabel>
              <Input
                ref={inputRef}
                id="event-images"
                type="file"
                accept={coverContentTypes.join(',')}
                multiple
                disabled={busy || eventImages.length >= 8}
                onChange={(inputEvent) => setFiles(Array.from(inputEvent.target.files ?? []))}
              />
              <FieldDescription>
                {eventImages.length}/8 images currently stored. Selected filenames become alt text.
              </FieldDescription>
            </Field>
            <Button
              className="w-fit"
              disabled={busy || files.length === 0}
              onClick={() => upload.mutate(files)}
            >
              {upload.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              Upload {files.length || ''} {files.length === 1 ? 'image' : 'images'}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      {eventImages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Images />
            </EmptyMedia>
            <EmptyTitle>No event images</EmptyTitle>
            <EmptyDescription>Add an image to give this event a catalog cover.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {eventImages.map((image, index) => (
            <Card key={image.id} className="pt-0">
              {image.url ? (
                <img
                  src={image.url}
                  alt={image.altText || `${event.title} image ${index + 1}`}
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-muted text-muted-foreground">
                  Image preview unavailable
                </div>
              )}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Image {index + 1}
                  {index === 0 ? <Badge>Cover</Badge> : null}
                </CardTitle>
                <CardDescription className="truncate" title={image.altText}>
                  {image.altText || 'No alt text'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Move image ${index + 1} earlier`}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Move image ${index + 1} later`}
                  disabled={busy || index === eventImages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        aria-label={`Delete image ${index + 1}`}
                        disabled={busy}
                      />
                    }
                  >
                    <Trash2 />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete image {index + 1}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the image from the event and object storage.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep image</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => remove.mutate(image.id)}
                      >
                        Delete image
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
