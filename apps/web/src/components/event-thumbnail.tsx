import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

type EventThumbnailProps = {
  src: string | null
  title: string
  eager?: boolean
  className?: string
  variant?: 'card' | 'compact'
}

export function EventThumbnail({
  src,
  title,
  eager = false,
  className,
  variant = 'card',
}: EventThumbnailProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const imageSrc = src && src !== failedSrc ? src : null
  const isCompact = variant === 'compact'

  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden bg-primary/10 text-primary',
        isCompact && 'size-12 shrink-0 rounded-xl',
        className,
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`Cover for ${title}`}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          sizes={
            isCompact
              ? '48px'
              : eager
                ? '(min-width: 1024px) 60vw, 100vw'
                : '(min-width: 1024px) 33vw, 100vw'
          }
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(imageSrc)}
        />
      ) : (
        <div
          role="img"
          aria-label={`No cover image for ${title}`}
          className={cn(
            'flex h-full flex-col justify-between p-5',
            isCompact && 'items-center justify-center p-0',
          )}
        >
          <span
            className={cn(
              'flex size-10 items-center justify-center rounded-full bg-background/80 ring-1 ring-primary/15',
              isCompact && 'size-8',
            )}
          >
            <CalendarDays aria-hidden="true" className={cn('size-5', isCompact && 'size-4')} />
          </span>
          {isCompact ? null : (
            <span className="line-clamp-2 max-w-[24ch] font-heading text-lg font-semibold text-foreground">
              {title}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
