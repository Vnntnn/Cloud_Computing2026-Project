import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TicketQrCode } from '../src/components/ticket-qr-code.tsx'

describe('TicketQrCode', () => {
  it('renders the signed token as an accessible QR without displaying the raw token', () => {
    const token = 'signed.ticket.payload'
    const markup = renderToStaticMarkup(
      <TicketQrCode eventTitle="Cloud Native Bangkok" token={token} />,
    )

    expect(markup).toContain('<svg')
    expect(markup).toContain('<title>Admission QR code for Cloud Native Bangkok</title>')
    expect(markup).not.toContain(token)
  })
})
