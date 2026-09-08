import { BrandMark } from '@/components/logo'

/**
 * Full-page pending state, wired as the router's defaultPendingComponent.
 * Pages that are already painted use an inline Spinner instead.
 */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60svh] flex-1 flex-col items-center justify-center gap-6 px-4"
    >
      <BrandMark size="lg" />
      <div className="w-48 overflow-hidden rounded-full bg-muted">
        <div className="h-1 w-2/5 animate-loading-sweep rounded-full bg-primary motion-reduce:animate-none" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
