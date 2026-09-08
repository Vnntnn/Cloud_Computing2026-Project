import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

type EventThumbnailProps = {
  src: string | null
  title: string
  eager?: boolean
  className?: string
}

export function EventThumbnail({ src, title, eager = false, className }: EventThumbnailProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const imageSrc = src && src !== failedSrc ? src : null

  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden bg-primary/10 text-primary',
        className,
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`Cover for ${title}`}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          sizes={eager ? '(min-width: 1024px) 60vw, 100vw' : '(min-width: 1024px) 33vw, 100vw'}
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(imageSrc)}
        />
      ) : (
        <div
          role="img"
          aria-label={`No cover image for ${title}`}
          className="flex h-full flex-col justify-between p-5"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-background/80 ring-1 ring-primary/15">
            <CalendarDays aria-hidden="true" className="size-5" />
          </span>
          <span className="line-clamp-2 max-w-[24ch] font-heading text-lg font-semibold text-foreground">
            {title}
          </span>
        </div>
      )}
    </div>
  )
}
