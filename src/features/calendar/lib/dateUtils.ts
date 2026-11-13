const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export { DAY_NAMES, MONTH_NAMES }

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function isPastDay(d: Date, today: Date): boolean {
  return startOfDay(d).getTime() < startOfDay(today).getTime()
}

/** Cells for a month grid, including leading/trailing days from adjacent months (Sun-start weeks). */
export interface MonthCell {
  date: Date
  inCurrentMonth: boolean
}

export function getMonthGrid(year: number, month: number): MonthCell[] {
  const firstOfMonth = new Date(year, month, 1)
  const startWeekday = firstOfMonth.getDay()
  const gridStart = new Date(year, month, 1 - startWeekday)

  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    cells.push({ date, inCurrentMonth: date.getMonth() === month })
  }
  return cells
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`
}

export function formatWeekdayMonthDay(d: Date): string {
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' })
  const month = MONTH_NAMES[d.getMonth()]
  return `${weekday}, ${month} ${d.getDate()}`
}

export function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

/** All 15-minute time-of-day slots, "00:00".."23:45". */
export function getTimeSlots(stepMinutes = 15): string[] {
  const slots: string[] = []
  for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return slots
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** The 7 dates (Sun-Sat) of the week containing `date`. */
export function getWeekDates(date: Date): Date[] {
  const startWeekday = date.getDay()
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() - startWeekday)
  return Array.from(
    { length: 7 },
    (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i),
  )
}

export function formatWeekRange(weekDates: Date[]): string {
  const start = weekDates[0]
  const end = weekDates[6]
  const startMonth = MONTH_NAMES[start.getMonth()]
  const endMonth = MONTH_NAMES[end.getMonth()]
  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`
}
