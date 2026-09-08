import { format } from 'date-fns'
import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type DateTimePickerProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  required?: boolean
  invalid?: boolean
  disabled?: boolean
}

const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

function parseDate(value: string) {
  const match = dateTimePattern.exec(value)
  if (!match) return undefined

  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))

  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : undefined
}

function formatDatePart(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  onBlur,
  required = false,
  invalid = false,
  disabled = false,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const date = parseDate(value)
  const datePart = value.slice(0, 10)
  const timePart = dateTimePattern.exec(value)?.slice(4, 6).join(':') ?? ''

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.25rem] gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              data-empty={!date}
              className="w-full justify-between font-normal data-[empty=true]:text-muted-foreground"
              disabled={disabled}
              aria-invalid={invalid}
              aria-required={required}
              onBlur={onBlur}
            />
          }
        >
          {date ? format(date, 'PPP') : 'Select date'}
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            onSelect={(selectedDate) => {
              if (!selectedDate) return
              onChange(`${formatDatePart(selectedDate)}T${timePart || '00:00'}`)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>

      <Input
        id={`${id}-time`}
        type="time"
        value={timePart}
        required={required}
        disabled={disabled}
        aria-label={`${label} time`}
        aria-invalid={invalid}
        onBlur={onBlur}
        onChange={(event) => onChange(`${datePart}T${event.target.value}`)}
        className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
    </div>
  )
}
