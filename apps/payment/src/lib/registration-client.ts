import { env } from '../env.ts'

export interface PaymentOrder {
  id: string
  userId: string
  status: string
  total: string
  currency: 'THB'
  refundPercent: number
  expiresAt: string
}

const headers = () => ({
  'content-type': 'application/json',
  'x-eventide-internal-token': env.INTERNAL_SERVICE_TOKEN,
})

export async function getPaymentOrder(orderId: string): Promise<PaymentOrder> {
  const response = await fetch(`${env.REGISTRATION_SERVICE_URL}/internal/orders/${orderId}`, {
    headers: headers(),
  })
  if (!response.ok) throw new Error(`registration order lookup returned ${response.status}`)
  return response.json() as Promise<PaymentOrder>
}

export async function confirmOrder(orderId: string, paymentId: string) {
  const response = await fetch(
    `${env.REGISTRATION_SERVICE_URL}/internal/orders/${orderId}/confirm`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ paymentId }) },
  )
  if (!response.ok) throw new Error(`registration confirm returned ${response.status}`)
}

export async function markPendingVerification(orderId: string) {
  await fetch(`${env.REGISTRATION_SERVICE_URL}/internal/orders/${orderId}/pending-verification`, {
    method: 'POST',
    headers: headers(),
  })
}

export async function refundOrder(orderId: string) {
  const response = await fetch(
    `${env.REGISTRATION_SERVICE_URL}/internal/orders/${orderId}/refund`,
    {
      method: 'POST',
      headers: headers(),
    },
  )
  if (!response.ok) throw new Error(`registration refund returned ${response.status}`)
}
