const bangkokDateTimeFormat = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Bangkok',
})

const dateTimeInputPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export function toBangkokDateTimeInput(value: string | number | Date) {
  return bangkokDateTimeFormat.format(new Date(value)).replace(' ', 'T')
}

export function bangkokDateTimeInputToIso(value: string) {
  return new Date(`${value}:00+07:00`).toISOString()
}

export function isDateTimeInput(value: string) {
  if (!dateTimeInputPattern.test(value)) return false
  const date = new Date(`${value}:00+07:00`)
  return !Number.isNaN(date.getTime()) && toBangkokDateTimeInput(date) === value
}
