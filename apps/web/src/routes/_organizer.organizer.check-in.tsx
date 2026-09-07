import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { edenReg } from '@/lib/eden'

export const Route = createFileRoute('/_organizer/organizer/check-in')({ component: CheckInPage })
function CheckInPage() {
  const [result, setResult] = useState('')
  const form = useForm({
    defaultValues: { eventId: '', qrToken: '' },
    onSubmit: async ({ value }) => {
      const response = await edenReg.api['check-ins'].post(value)
      setResult(response.error ? 'INVALID' : String((response.data as { result: string }).result))
    },
  })
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>Ticket check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          id="check-in-form"
          onSubmit={(e) => {
            e.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            {(['eventId', 'qrToken'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      {name === 'eventId' ? 'Event ID' : 'Signed ticket token'}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
            ))}
            {result ? <Badge>{result}</Badge> : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button form="check-in-form" type="submit">
          Validate ticket
        </Button>
      </CardFooter>
    </Card>
  )
}
