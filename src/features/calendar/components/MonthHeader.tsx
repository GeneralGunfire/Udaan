import { Button } from '@/shared/components/ui/button'
import { ChevronRightIcon } from '@/shared/icons'
import { formatMonthYear } from '../lib/dateUtils'

export interface MonthHeaderProps {
  year: number
  month: number
  onPrev: () => void
  onNext: () => void
}

export function MonthHeader({ year, month, onPrev, onNext }: MonthHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Previous month">
        <ChevronRightIcon width={15} height={15} className="rotate-180" />
      </Button>
      <span className="font-display text-text-primary text-base font-semibold">
        {formatMonthYear(year, month)}
      </span>
      <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next month">
        <ChevronRightIcon width={15} height={15} />
      </Button>
    </div>
  )
}
