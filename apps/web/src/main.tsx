import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { NotFound, RouteError } from '@/components/route-states'
import { Toaster } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { MessageKey } from '@/i18n'
import '@/lib/theme'
import './index.css'
import { routeTree } from './routeTree.gen'

const queryClient = new QueryClient()
// route guards read the session through the query cache in beforeLoad
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultViewTransition: true,
  defaultNotFoundComponent: () => <NotFound />,
  defaultErrorComponent: RouteError,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  // the page's browser tab title, as a message key; PageTitle (routes/__root.tsx) reads the deepest match that has one
  interface StaticDataRouteOption {
    title?: MessageKey
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster>
          <RouterProvider router={router} />
        </Toaster>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
