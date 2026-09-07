import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-border bg-card px-3 py-2 text-sm',
        'outline-none focus:border-accent',
        className,
      )}
      {...props}
    />
  )
}
