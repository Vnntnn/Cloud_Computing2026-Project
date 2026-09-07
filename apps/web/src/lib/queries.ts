import { queryOptions } from '@tanstack/react-query'
import { edenEvent, edenReg } from './eden'

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
