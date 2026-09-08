import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BrandMark } from '@/components/logo'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '@/lib/auth'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      setError('')
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email: value.email, password: value.password })
          : await authClient.signUp.email(value)
      if (result.error) setError(result.error.message ?? 'Authentication failed')
      else await navigate({ to: '/' })
    },
  })
  return (
    <div className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center gap-6 overflow-hidden px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <BrandMark size="lg" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'sign-in' ? 'Welcome back' : 'Create an account'}</CardTitle>
          <CardDescription>Use email and password or continue with Google.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="auth-form"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <FieldGroup>
              {mode === 'sign-up' ? (
                <form.Field
                  name="name"
                  validators={{
                    onChange: ({ value }) =>
                      value.trim().length < 2 ? 'Enter your name' : undefined,
                  }}
                >
                  {(field) => (
                    <Field data-invalid={!field.state.meta.isValid}>
                      <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                      <Input
                        id={field.name}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={!field.state.meta.isValid}
                      />
                      <FieldError
                        errors={field.state.meta.errors.map((message) => ({ message }))}
                      />
                    </Field>
                  )}
                </form.Field>
              ) : null}
              <form.Field
                name="email"
                validators={{
                  onChange: ({ value }) =>
                    value.includes('@') ? undefined : 'Enter a valid email',
                }}
              >
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid}>
                    <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                    <Input
                      id={field.name}
                      type="email"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={!field.state.meta.isValid}
                    />
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
              <form.Field
                name="password"
                validators={{
                  onChange: ({ value }) =>
                    value.length >= 8 ? undefined : 'Use at least 8 characters',
                }}
              >
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid}>
                    <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                    <Input
                      id={field.name}
                      type="password"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={!field.state.meta.isValid}
                    />
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, submitting]) => (
              <Button
                form="auth-form"
                type="submit"
                className="w-full"
                disabled={!canSubmit || submitting}
              >
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                {mode === 'sign-in' ? 'Log in' : 'Sign up'}
              </Button>
            )}
          </form.Subscribe>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}
          >
            Continue with Google
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
          >
            {mode === 'sign-in' ? 'Need an account?' : 'Already registered?'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
