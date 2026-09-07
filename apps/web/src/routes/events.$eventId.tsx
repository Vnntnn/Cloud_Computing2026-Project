import { useForm } from '@tanstack/react-form'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Calendar, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { edenPayment, edenReg } from '@/lib/eden'
import { eventQuery } from '@/lib/queries'

export const Route = createFileRoute('/events/$eventId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(eventQuery(params.eventId)),
  component: EventPage,
})

function EventPage() {
  const { eventId } = Route.useParams()
  const navigate = useNavigate()
  const { data: event } = useSuspenseQuery(eventQuery(eventId))
  const mutation = useMutation({
    mutationFn: async (value: { ticketTypeId: string; quantity: number }) => {
      const orderResult = await edenReg.api.orders.post(
        { eventId, items: [value] },
        { headers: { 'idempotency-key': crypto.randomUUID() } },
      )
      if (orderResult.error || !orderResult.data) throw new Error('Reservation failed')
      const paymentResult = await edenPayment.api.payments.checkout.post(
        { orderId: orderResult.data.id },
        { headers: { 'idempotency-key': crypto.randomUUID() } },
      )
      if (paymentResult.error || !paymentResult.data) throw new Error('Payment failed')
      return paymentResult.data
    },
    onSuccess: async (payment) => {
      toast.success(
        payment.status === 'SUCCEEDED' ? 'Payment complete' : 'Payment is being verified',
      )
      await navigate({ to: '/tickets' })
    },
    onError: (error) => toast.error(error.message),
  })
  const first = event.ticketTypes[0]
  const form = useForm({
    defaultValues: { ticketTypeId: first?.id ?? '', quantity: 1 },
    onSubmit: ({ value }) => mutation.mutateAsync(value),
  })
  return (
    <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
      <section className="flex flex-col gap-5">
        {event.coverUrl ? (
          <img src={event.coverUrl} alt="" className="aspect-video rounded-4xl object-cover" />
        ) : null}
        <div className="flex gap-2">
          <Badge>{event.status}</Badge>
          <Badge variant="secondary">Refund {event.refundPercent}%</Badge>
        </div>
        <h1 className="font-heading text-4xl font-semibold">{event.title}</h1>
        <p className="flex items-center gap-2 text-muted-foreground">
          <Calendar />
          {new Date(event.startsAt).toLocaleString('en-TH', { timeZone: 'Asia/Bangkok' })}
        </p>
        <p className="flex items-center gap-2 text-muted-foreground">
          <MapPin />
          Thailand
        </p>
        <p className="leading-7">{event.description}</p>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Choose tickets</CardTitle>
          <CardDescription>Your reservation is held for eight minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          {first ? (
            <form
              id="checkout-form"
              onSubmit={(e) => {
                e.preventDefault()
                void form.handleSubmit()
              }}
            >
              <FieldGroup>
                <form.Field name="ticketTypeId">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>Ticket type</FieldLabel>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value ?? '')}
                      >
                        <SelectTrigger id={field.name}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {event.ticketTypes.map((type) => (
                              <SelectItem key={type.id} value={type.id}>
                                {type.name} — ฿{type.price}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
                <form.Field
                  name="quantity"
                  validators={{
                    onChange: ({ value }) =>
                      value > 0 && value <= 20 ? undefined : 'Choose 1–20 tickets',
                  }}
                >
                  {(field) => (
                    <Field data-invalid={!field.state.meta.isValid}>
                      <FieldLabel htmlFor={field.name}>Quantity</FieldLabel>
                      <Input
                        id={field.name}
                        type="number"
                        min={1}
                        max={20}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.valueAsNumber)}
                        aria-invalid={!field.state.meta.isValid}
                      />
                      <FieldError
                        errors={field.state.meta.errors.map((message) => ({ message }))}
                      />
                    </Field>
                  )}
                </form.Field>
              </FieldGroup>
            </form>
          ) : (
            <p className="text-muted-foreground">Tickets are not available yet.</p>
          )}
        </CardContent>
        <CardFooter>
          <Button form="checkout-form" type="submit" disabled={!first || mutation.isPending}>
            {mutation.isPending ? 'Processing…' : 'Reserve and pay now'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
