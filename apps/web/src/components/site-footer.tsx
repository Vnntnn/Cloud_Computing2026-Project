import { Link } from '@tanstack/react-router'
import { BrandMark } from '@/components/logo'

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BrandMark size="sm" />
          <span className="hidden sm:inline">— Cloud Computing 2026, IT KMITL</span>
        </div>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/events" className="hover:text-foreground">
            Events
          </Link>
          <Link to="/profile" className="hover:text-foreground">
            Become an organizer
          </Link>
        </nav>
      </div>
    </footer>
  )
}
