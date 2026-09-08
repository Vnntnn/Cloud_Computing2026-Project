import { useMutation, useQuery } from '@tanstack/react-query'
import type { IScannerControls } from '@zxing/browser'
import { Camera, CameraOff, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { edenReg } from '@/lib/eden'
import { managedEventsQuery } from '@/lib/queries'

type CheckInResult = 'SUCCESS' | 'DUPLICATE' | 'INVALID' | 'CANCELLED' | 'REFUNDED' | 'WRONG_EVENT'

const outcomeCopy: Record<
  CheckInResult,
  { description: string; label: string; variant: 'default' | 'destructive' | 'secondary' }
> = {
  SUCCESS: {
    label: 'Checked in',
    description: 'The ticket is valid and has now been marked as used.',
    variant: 'default',
  },
  DUPLICATE: {
    label: 'Already used',
    description: 'This ticket was checked in earlier. Do not admit it again.',
    variant: 'destructive',
  },
  INVALID: {
    label: 'Invalid code',
    description: 'The QR code is not a valid signed Eventide ticket.',
    variant: 'destructive',
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'This ticket belongs to a cancelled registration.',
    variant: 'destructive',
  },
  REFUNDED: {
    label: 'Refunded',
    description: 'This ticket was refunded and cannot be used.',
    variant: 'destructive',
  },
  WRONG_EVENT: {
    label: 'Wrong event',
    description: 'This ticket is valid for a different event.',
    variant: 'destructive',
  },
}

type CheckInScannerProps = {
  initialEventId?: string
}

export function CheckInScanner({ initialEventId = '' }: CheckInScannerProps) {
  const { data: events } = useQuery(managedEventsQuery)
  const [eventId, setEventId] = useState(initialEventId)
  const [manualToken, setManualToken] = useState('')
  const [outcome, setOutcome] = useState<CheckInResult | null>(null)
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'scanning'>('idle')
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const scanLockedRef = useRef(false)

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    const stream = videoRef.current?.srcObject
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => {
        track.stop()
      })
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraState('idle')
  }, [])

  const checkIn = useMutation({
    mutationFn: async (qrToken: string) => {
      if (!eventId) throw new Error('Choose an event before scanning a ticket.')
      const { data, error } = await edenReg.api['check-ins'].post({ eventId, qrToken })
      if (error || !data) throw new Error('The check-in service could not validate this ticket.')
      return String((data as { result: string }).result) as CheckInResult
    },
    onSuccess: (result) => {
      setOutcome(result)
      if (result === 'SUCCESS') toast.success('Ticket checked in')
    },
    onError: (error) => {
      setOutcome(null)
      toast.error(error instanceof Error ? error.message : 'Unable to check in ticket')
    },
  })

  const submitToken = useCallback(
    async (token: string) => {
      const normalized = token.trim()
      if (!normalized) {
        toast.error('Scan a QR code or enter a ticket token.')
        return
      }
      stopCamera()
      await checkIn.mutateAsync(normalized).catch(() => undefined)
    },
    [checkIn, stopCamera],
  )

  const startCamera = async () => {
    if (!eventId) {
      toast.error('Choose an event before starting the camera.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera scanning is not supported in this browser. Enter the token instead.')
      return
    }

    stopCamera()
    setOutcome(null)
    setCameraState('starting')
    scanLockedRef.current = false
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 })
      const video = videoRef.current
      if (!video) throw new Error('Camera preview is unavailable.')
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, _error, activeControls) => {
          if (!result || scanLockedRef.current) return
          scanLockedRef.current = true
          activeControls.stop()
          void submitToken(result.getText())
        },
      )
      if (scanLockedRef.current) {
        controls.stop()
        return
      }
      controlsRef.current = controls
      setCameraState('scanning')
    } catch (error) {
      stopCamera()
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        toast.error('Camera access was denied. Allow access or enter the token instead.')
      } else {
        toast.error(error instanceof Error ? error.message : 'Unable to start the camera')
      }
    }
  }

  useEffect(() => stopCamera, [stopCamera])

  const selectedOutcome = outcome ? outcomeCopy[outcome] : null

  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <CardHeader>
        <CardTitle>QR ticket check-in</CardTitle>
        <CardDescription>
          Choose the event, then place one attendee QR inside the frame.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[minmax(0,1.25fr)_minmax(16rem,0.75fr)]">
        <div className="relative aspect-4/3 overflow-hidden rounded-3xl bg-foreground">
          <video
            ref={videoRef}
            className="size-full object-cover"
            muted
            playsInline
            aria-label="QR scanner camera preview"
          />
          {cameraState === 'idle' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-foreground text-background">
              <ScanLine className="size-12" aria-hidden="true" />
              <p className="max-w-56 text-center text-sm">
                Camera is off. Choose an event and start scanning.
              </p>
            </div>
          ) : null}
          {cameraState === 'starting' ? (
            <div className="absolute inset-0 flex items-center justify-center bg-foreground/80 text-background">
              <p className="text-sm">Starting camera…</p>
            </div>
          ) : null}
          {cameraState === 'scanning' ? (
            <div className="pointer-events-none absolute inset-[12%] rounded-3xl border-2 border-background/90" />
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="check-in-event">Event</FieldLabel>
              <Select
                items={(events?.items ?? []).map((event) => ({
                  value: event.id,
                  label: event.title,
                }))}
                value={eventId}
                onValueChange={(value) => {
                  stopCamera()
                  setEventId(value ?? '')
                  setOutcome(null)
                }}
              >
                <SelectTrigger id="check-in-event" className="w-full">
                  <SelectValue placeholder="Choose an event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {events?.items.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                The selected event is enforced by the check-in service.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <div className="flex flex-wrap gap-2">
            {cameraState === 'idle' ? (
              <Button type="button" onClick={() => void startCamera()} disabled={checkIn.isPending}>
                <Camera data-icon="inline-start" />
                Start camera
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={stopCamera}>
                <CameraOff data-icon="inline-start" />
                Stop camera
              </Button>
            )}
          </div>

          {selectedOutcome ? (
            <Alert aria-live="polite" variant={outcome === 'SUCCESS' ? 'default' : 'destructive'}>
              <AlertTitle className="flex items-center gap-2">
                {selectedOutcome.label}
                <Badge variant={selectedOutcome.variant}>{outcome}</Badge>
              </AlertTitle>
              <AlertDescription>{selectedOutcome.description}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
      <CardFooter>
        <form
          className="w-full"
          onSubmit={(event) => {
            event.preventDefault()
            void submitToken(manualToken)
          }}
        >
          <FieldGroup className="gap-3 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor="manual-ticket-token">Manual fallback</FieldLabel>
              <Input
                id="manual-ticket-token"
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="Paste the signed ticket token"
                autoComplete="off"
              />
            </Field>
            <Button type="submit" variant="outline" disabled={checkIn.isPending}>
              Validate ticket
            </Button>
          </FieldGroup>
        </form>
      </CardFooter>
    </Card>
  )
}
