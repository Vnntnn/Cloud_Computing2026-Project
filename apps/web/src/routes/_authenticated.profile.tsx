import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
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
import { authApiFetch } from '@/lib/auth'

export const Route = createFileRoute('/_authenticated/profile')({ component: ProfilePage })
function ProfilePage() {
  const [message, setMessage] = useState('')
  const form = useForm({
    defaultValues: { displayName: '', contactEmail: '', contactPhone: '' },
    onSubmit: async ({ value }) => {
      const response = await authApiFetch('/api/users/me/organizer-application', {
        method: 'POST',
        body: JSON.stringify(value),
      })
      setMessage(
        response.ok ? 'Application submitted for review.' : 'Could not submit application.',
      )
    },
  })
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Become an organizer</CardTitle>
        <CardDescription>Submit contact details for administrator approval.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="organizer-form"
          onSubmit={(e) => {
            e.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            {(['displayName', 'contactEmail', 'contactPhone'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{name}</FieldLabel>
                    <Input
                      id={field.name}
                      type={name === 'contactEmail' ? 'email' : 'text'}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError
                      errors={field.state.meta.errors.map((error) => ({ message: error }))}
                    />
                  </Field>
                )}
              </form.Field>
            ))}
            {message ? <p>{message}</p> : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button form="organizer-form" type="submit">
          Submit application
        </Button>
      </CardFooter>
    </Card>
  )
}
