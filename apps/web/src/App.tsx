import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom'
import { Button } from './components/ui/button'
import { authClient, signOut } from './lib/auth'
import { EventDetail } from './pages/EventDetail'
import { EventList } from './pages/EventList'
import { Login } from './pages/Login'
import { MyTickets } from './pages/MyTickets'

function Nav() {
  const { data: session } = authClient.useSession()
  const navigate = useNavigate()
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-3">
      <Link to="/" className="font-semibold">
        Eventide
      </Link>
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/" className="px-2 py-1 hover:underline">
          Events
        </Link>
        {session ? (
          <>
            <Link to="/tickets" className="px-2 py-1 hover:underline">
              My tickets
            </Link>
            <span className="px-2 text-muted">{session.user.email}</span>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut()
                navigate('/')
              }}
            >
              Log out
            </Button>
          </>
        ) : (
          <Link to="/login" className="px-2 py-1 hover:underline">
            Log in
          </Link>
        )}
      </nav>
    </header>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Nav />
      <main className="mx-auto max-w-3xl p-4">
        <Routes>
          <Route path="/" element={<EventList />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/tickets" element={<MyTickets />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
