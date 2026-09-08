import { cn } from '@/lib/cn'

type Size = 'sm' | 'md' | 'lg'

const markSize: Record<Size, string> = {
  sm: 'size-6',
  md: 'size-7',
  lg: 'size-9 sm:size-10',
}

const wordSize: Record<Size, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl sm:text-3xl',
}

/**
 * Inline SVG so the mark inherits `currentColor` and needs no asset file. A
 * ticket stub: rounded body, a perforation down the middle, two edge notches.
 */
export function IconMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Eventide"
      className={cn('text-primary', className)}
    >
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v2a2 2 0 0 0 0 5v2a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-2a2 2 0 0 0 0-5v-2Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 6.5v11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="0.1 3"
      />
    </svg>
  )
}

export function Wordmark({ size = 'md', className }: { size?: Size; className?: string }) {
  return (
    <span
      className={cn(
        'font-heading font-black tracking-tight text-foreground',
        wordSize[size],
        className,
      )}
    >
      Event<span className="text-primary">ide</span>
    </span>
  )
}

export function BrandMark({ size = 'md', className }: { size?: Size; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <IconMark className={markSize[size]} />
      <Wordmark size={size} />
    </span>
  )
}
