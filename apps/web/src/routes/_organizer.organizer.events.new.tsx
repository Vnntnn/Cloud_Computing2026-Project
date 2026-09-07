import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { edenEvent } from '@/lib/eden'

const localTime = (offsetHours: number) => {
  const date = new Date(Date.now() + offsetHours * 3_600_000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export const Route = createFileRoute('/_organizer/organizer/events/new')({
  component: CreateEventPage,
})
function CreateEventPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: {
      title: '',
      description: '',
      startsAt: localTime(48),
      endsAt: localTime(51),
      salesStartAt: localTime(0),
      salesEndAt: localTime(47),
      capacity: 100,
      refundPercent: 100,
      ticketName: 'General admission',
      price: '500.00',
    },
    onSubmit: async ({ value }) => {
      setError('')
      const created = await edenEvent.api.events.post({
        title: value.title,
        description: value.description,
        startsAt: new Date(value.startsAt).toISOString(),
        endsAt: new Date(value.endsAt).toISOString(),
        salesStartAt: new Date(value.salesStartAt).toISOString(),
        salesEndAt: new Date(value.salesEndAt).toISOString(),
        capacity: value.capacity,
        refundPercent: value.refundPercent,
      })
      if (created.error || !created.data || created.data instanceof Response)
        return setError('Could not create event. Confirm organizer approval and dates.')
      const ticket = await edenEvent.api['ticket-types'].post({
        eventId: created.data.id,
        name: value.ticketName,
        price: value.price,
        quota: value.capacity,
        maxPerOrder: 10,
      })
      if (ticket.error) return setError('Event created, but its ticket type needs attention.')
      await navigate({ to: '/events/$eventId', params: { eventId: created.data.id } })
    },
  })
  const textFields = [
    { name: 'title', label: 'Event title', type: 'text' },
    { name: 'ticketName', label: 'Ticket name', type: 'text' },
    { name: 'price', label: 'Price (THB)', type: 'text' },
    { name: 'startsAt', label: 'Starts', type: 'datetime-local' },
    { name: 'endsAt', label: 'Ends', type: 'datetime-local' },
    { name: 'salesStartAt', label: 'Sales start', type: 'datetime-local' },
    { name: 'salesEndAt', label: 'Sales end', type: 'datetime-local' },
  ] as const
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Create an event</CardTitle>
        <CardDescription>
          Events begin as drafts. Add the first ticket type now, then publish when ready.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="event-form"
          onSubmit={(e) => {
            e.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            {textFields.map(({ name, label, type }) => (
              <form.Field
                key={name}
                name={name}
                validators={{
                  onChange: ({ value }) =>
                    String(value).trim() ? undefined : `${label} is required`,
                }}
              >
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid}>
                    <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
                    <Input
                      id={field.name}
                      type={type}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={!field.state.meta.isValid}
                    />
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
            ))}
            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                  <Textarea
                    id={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="capacity">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Capacity</FieldLabel>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.valueAsNumber)}
                  />
                </Field>
              )}
            </form.Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button form="event-form" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create draft'}
            </Button>
          )}
        </form.Subscribe>
      </CardFooter>
    </Card>
  )
}
