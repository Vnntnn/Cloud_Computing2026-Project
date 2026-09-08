import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CheckInScanner } from '@/components/check-in-scanner'
import { managedEventsQuery } from '@/lib/queries'

const searchSchema = z.object({ eventId: z.string().uuid().optional() })

export const Route = createFileRoute('/_admin/admin/check-in')({
  validateSearch: searchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(managedEventsQuery),
  component: AdminCheckInPage,
})

function AdminCheckInPage() {
  const { eventId } = Route.useSearch()
  return <CheckInScanner initialEventId={eventId} />
}
