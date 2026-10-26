import * as React from "react"

// the dashboard sidebar becomes a drawer below this width (lg): at 820px an open sidebar left tables about 520px, hiding their dates, statuses and row actions
const MOBILE_BREAKPOINT = 1024
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// read from the media query on the first render (this is a SPA), so a tablet never paints the desktop sidebar and then swaps it for a drawer
export function useIsMobile() {
  return React.useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(QUERY)
      mql.addEventListener("change", notify)
      return () => mql.removeEventListener("change", notify)
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
