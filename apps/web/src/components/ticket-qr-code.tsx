import { QRCodeSVG } from 'qrcode.react'

type TicketQrCodeProps = {
  eventTitle: string
  token: string
}

export function TicketQrCode({ eventTitle, token }: TicketQrCodeProps) {
  return (
    <div className="mx-auto w-full max-w-64 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5">
      <QRCodeSVG
        value={token}
        title={`Admission QR code for ${eventTitle}`}
        level="M"
        marginSize={4}
        className="h-auto w-full"
      />
    </div>
  )
}
