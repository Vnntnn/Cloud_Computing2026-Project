import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

export function RouteError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : ''
  return (
    <div className="container mx-auto flex min-h-[60svh] items-center justify-center px-4 py-16">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>{message || 'This page failed to load.'}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </Empty>
    </div>
  )
}
