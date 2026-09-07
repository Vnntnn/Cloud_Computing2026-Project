import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { authClient } from '../lib/auth'

export function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res =
      mode === 'sign-in'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name })
    setBusy(false)
    if (res.error) setError(res.error.message ?? 'Failed')
    else navigate('/tickets')
  }

  return (
    <Card className="mx-auto max-w-sm">
      <h1 className="text-lg font-semibold">
        {mode === 'sign-in' ? 'Log in' : 'Create an account'}
      </h1>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode === 'sign-up' && (
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {mode === 'sign-in' ? 'Log in' : 'Sign up'}
        </Button>
      </form>
      <button
        type="button"
        className="mt-3 text-sm text-muted underline"
        onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
      >
        {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Log in'}
      </button>
      <Button
        variant="outline"
        className="mt-4 w-full"
        onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/tickets' })}
      >
        Continue with Google
      </Button>
    </Card>
  )
}
