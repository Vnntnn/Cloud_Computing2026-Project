import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DateTimePicker } from '@/components/date-time-picker'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { edenEvent } from '@/lib/eden'
import {
  bangkokDateTimeInputToIso,
  isDateTimeInput,
  toBangkokDateTimeInput,
} from '@/lib/event-dates'
import { eventQuery } from '@/lib/queries'

export const Route = createFileRoute('/_organizer/organizer/events/$eventId/edit')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(eventQuery(params.eventId)),
  component: EditEventPage,
})

type EventFormValues = {
  title: string
  description: string
  startsAt: string
  endsAt: string
  salesStartAt: string
  salesEndAt: string
  capacity: number
  refundPercent: number
}

const dateFields = [
  { name: 'startsAt', label: 'Starts' },
  { name: 'endsAt', label: 'Ends' },
  { name: 'salesStartAt', label: 'Sales start' },
  { name: 'salesEndAt', label: 'Sales end' },
] as const

function EditEventPage() {
  const { eventId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: event } = useSuspenseQuery(eventQuery(eventId))
  const [error, setError] = useState('')

  const updateEvent = useMutation({
    mutationFn: async (value: EventFormValues) => {
      const result = await edenEvent.api.events({ id: eventId }).patch({
        title: value.title.trim(),
        description: value.description.trim(),
        startsAt: bangkokDateTimeInputToIso(value.startsAt),
        endsAt: bangkokDateTimeInputToIso(value.endsAt),
        salesStartAt: bangkokDateTimeInputToIso(value.salesStartAt),
        salesEndAt: bangkokDateTimeInputToIso(value.salesEndAt),
        capacity: value.capacity,
        refundPercent: value.refundPercent,
      })
      if (result.error || !result.data || result.data instanceof Response)
        throw new Error('The event could not be updated. Check the dates and try again.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event updated')
      await navigate({ to: '/organizer/events' })
    },
    onError: (mutationError) => setError(mutationError.message),
  })

  const form = useForm({
    defaultValues: {
      title: event.title,
      description: event.description,
      startsAt: toBangkokDateTimeInput(event.startsAt),
      endsAt: toBangkokDateTimeInput(event.endsAt),
      salesStartAt: toBangkokDateTimeInput(event.salesStartAt),
      salesEndAt: toBangkokDateTimeInput(event.salesEndAt),
      capacity: event.capacity,
      refundPercent: event.refundPercent,
    } satisfies EventFormValues,
    onSubmit: async ({ value }) => {
      setError('')
      const startsAt = bangkokDateTimeInputToIso(value.startsAt)
      const endsAt = bangkokDateTimeInputToIso(value.endsAt)
      const salesStartAt = bangkokDateTimeInputToIso(value.salesStartAt)
      const salesEndAt = bangkokDateTimeInputToIso(value.salesEndAt)

      if (endsAt <= startsAt) {
        setError('The event must end after it starts.')
        return
      }
      if (salesEndAt <= salesStartAt) {
        setError('Ticket sales must end after they start.')
        return
      }

      try {
        await updateEvent.mutateAsync(value)
      } catch {
        // The mutation error handler provides the user-facing message.
      }
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edit event"
        description={event.title}
        actions={
          <Button variant="outline" render={<Link to="/organizer/events" />}>
            Back to events
          </Button>
        }
      />

      {event.status === 'CLOSED' || event.status === 'SUSPENDED' ? (
        <Alert>
          <LockKeyhole />
          <AlertTitle>Editing is locked</AlertTitle>
          <AlertDescription>
            Closed and suspended events cannot be edited. This event is currently{' '}
            {event.status.toLowerCase()}.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Event details</CardTitle>
            <CardDescription>
              Update the listing, schedule, capacity, and refund policy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id="edit-event-form"
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault()
                void form.handleSubmit()
              }}
            >
              <FieldGroup>
                <form.Field
                  name="title"
                  validators={{
                    onChange: ({ value }) => (value.trim() ? undefined : 'Event title is required'),
                  }}
                >
                  {(field) => (
                    <Field data-invalid={!field.state.meta.isValid}>
                      <FieldLabel htmlFor={field.name}>Event title</FieldLabel>
                      <Input
                        id={field.name}
                        value={field.state.value}
                        maxLength={200}
                        required
                        aria-invalid={!field.state.meta.isValid}
                        onBlur={field.handleBlur}
                        onChange={(inputEvent) => field.handleChange(inputEvent.target.value)}
                      />
                      <FieldError
                        errors={field.state.meta.errors.map((message) => ({ message }))}
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="description">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                      <Textarea
                        id={field.name}
                        value={field.state.value}
                        maxLength={10000}
                        rows={6}
                        onBlur={field.handleBlur}
                        onChange={(inputEvent) => field.handleChange(inputEvent.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>

                <FieldSet>
                  <FieldLegend>Schedule</FieldLegend>
                  <FieldDescription>Dates and times use Bangkok time (ICT).</FieldDescription>
                  <FieldGroup className="grid gap-5 md:grid-cols-2">
                    {dateFields.map(({ name, label }) => (
                      <form.Field
                        key={name}
                        name={name}
                        validators={{
                          onChange: ({ value }) =>
                            isDateTimeInput(value) ? undefined : `${label} is required`,
                        }}
                      >
                        {(field) => (
                          <Field data-invalid={!field.state.meta.isValid}>
                            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
                            <DateTimePicker
                              id={field.name}
                              label={label}
                              value={field.state.value}
                              required
                              invalid={!field.state.meta.isValid}
                              onBlur={field.handleBlur}
                              onChange={field.handleChange}
                            />
                            <FieldError
                              errors={field.state.meta.errors.map((message) => ({ message }))}
                            />
                          </Field>
                        )}
                      </form.Field>
                    ))}
                  </FieldGroup>
                </FieldSet>

                <FieldSet>
                  <FieldLegend>Ticket policy</FieldLegend>
                  <FieldGroup className="grid gap-5 md:grid-cols-2">
                    <form.Field
                      name="capacity"
                      validators={{
                        onChange: ({ value }) =>
                          Number.isInteger(value) && value > 0
                            ? undefined
                            : 'Capacity must be at least 1',
                      }}
                    >
                      {(field) => (
                        <Field data-invalid={!field.state.meta.isValid}>
                          <FieldLabel htmlFor={field.name}>Capacity</FieldLabel>
                          <Input
                            id={field.name}
                            type="number"
                            min={1}
                            value={field.state.value}
                            required
                            aria-invalid={!field.state.meta.isValid}
                            onBlur={field.handleBlur}
                            onChange={(inputEvent) =>
                              field.handleChange(inputEvent.target.valueAsNumber)
                            }
                          />
                          <FieldError
                            errors={field.state.meta.errors.map((message) => ({ message }))}
                          />
                        </Field>
                      )}
                    </form.Field>

                    <form.Field
                      name="refundPercent"
                      validators={{
                        onChange: ({ value }) =>
                          Number.isInteger(value) && value >= 0 && value <= 100
                            ? undefined
                            : 'Refund percentage must be between 0 and 100',
                      }}
                    >
                      {(field) => (
                        <Field data-invalid={!field.state.meta.isValid}>
                          <FieldLabel htmlFor={field.name}>Refund percentage</FieldLabel>
                          <Input
                            id={field.name}
                            type="number"
                            min={0}
                            max={100}
                            value={field.state.value}
                            required
                            aria-invalid={!field.state.meta.isValid}
                            onBlur={field.handleBlur}
                            onChange={(inputEvent) =>
                              field.handleChange(inputEvent.target.valueAsNumber)
                            }
                          />
                          <FieldError
                            errors={field.state.meta.errors.map((message) => ({ message }))}
                          />
                        </Field>
                      )}
                    </form.Field>
                  </FieldGroup>
                </FieldSet>

                {error ? <FieldError>{error}</FieldError> : null}
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="justify-end gap-3">
            <Button variant="outline" render={<Link to="/organizer/events" />}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button form="edit-event-form" type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
                  {isSubmitting ? 'Saving…' : 'Save changes'}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
