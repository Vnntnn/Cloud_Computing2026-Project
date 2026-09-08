import { queryOptions } from '@tanstack/react-query'
import { authApiFetch } from './auth'
import { edenEvent, edenPayment, edenReg } from './eden'

export type AdminUser = {
  id: string
  name: string
  email: string
  role?: string
  organizerApprovalStatus: string
  banned?: boolean
}

export type AuditLog = {
  id: string
  actorId: string | null
  targetUserId: string | null
  action: string
  details: string | null
  createdAt: string
}

export type EventSearch = {
  q?: string
  category?: string
  province?: string
  page: number
  pageSize: number
}

export const eventsQuery = (search: EventSearch) =>
  queryOptions({
    queryKey: ['events', search],
    queryFn: async () => {
      const { data, error } = await edenEvent.api.events.get({ query: search })
      if (error || !data) throw new Error('Unable to load events')
      return data
    },
  })

export const eventQuery = (id: string) =>
  queryOptions({
    queryKey: ['events', id],
    queryFn: async () => {
      const { data, error } = await edenEvent.api.events({ id }).get()
      if (error || !data) throw new Error('Event not found')
      return data
    },
  })

export const eventImagesQuery = (id: string) =>
  queryOptions({
    queryKey: ['events', id, 'images'],
    queryFn: async () => {
      const { data, error } = await edenEvent.api.events({ id }).images.get()
      if (error || !data) throw new Error('Unable to load event images')
      return data
    },
  })

export const salesSummaryQuery = (eventId: string) =>
  queryOptions({
    queryKey: ['events', eventId, 'sales-summary'],
    queryFn: async () => {
      const { data, error } = await edenReg.api.orders
        .events({ id: eventId })
        ['sales-summary'].get()
      if (error || !data) throw new Error('Unable to load sales summary')
      return data
    },
  })

export const ordersQuery = queryOptions({
  queryKey: ['orders', 'me'],
  queryFn: async () => {
    const { data, error } = await edenReg.api.orders.me.get()
    if (error || !data) throw new Error('Unable to load orders')
    return data
  },
})

export const ticketsQuery = queryOptions({
  queryKey: ['tickets', 'me'],
  queryFn: async () => {
    const { data, error } = await edenReg.api.tickets.me.get()
    if (error || !data) throw new Error('Unable to load tickets')
    return data
  },
})

export const managedEventsQuery = queryOptions({
  queryKey: ['events', 'managed'],
  queryFn: async () => {
    const { data, error } = await edenEvent.api.organizer.events.get({
      query: { page: 1, pageSize: 100 },
    })
    if (error || !data || data instanceof Response) throw new Error('Unable to load managed events')
    return data
  },
})

export const adminUsersQuery = queryOptions({
  queryKey: ['admin', 'users'],
  queryFn: async () => {
    const response = await authApiFetch('/api/admin/users?page=1&pageSize=100')
    if (!response.ok) throw new Error('Unable to load users')
    return ((await response.json()) as { items: AdminUser[] }).items
  },
})

export const adminAuditLogsQuery = queryOptions({
  queryKey: ['admin', 'audit-logs'],
  queryFn: async () => {
    const response = await authApiFetch('/api/admin/audit-logs?page=1&pageSize=100')
    if (!response.ok) throw new Error('Unable to load audit logs')
    return (await response.json()) as AuditLog[]
  },
})

export const adminPaymentsQuery = queryOptions({
  queryKey: ['admin', 'payments'],
  queryFn: async () => {
    const { data, error } = await edenPayment.api.payments.admin.get({ query: {} })
    if (error || !data) throw new Error('Unable to load payments')
    return data
  },
})
