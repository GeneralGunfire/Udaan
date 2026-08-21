import { GlassPanel } from '@/shared/components/GlassPanel'
import { FileTextIcon } from '@/shared/icons'

/** Placeholder — built out in section 3 of this session. */
export function PdfToolView() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 py-4">
      <div className="flex items-center gap-2">
        <FileTextIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">PDF Tool</h1>
      </div>
      <GlassPanel>
        <p className="text-text-secondary text-[12.5px]">Coming up next in this session.</p>
      </GlassPanel>
    </div>
  )
}
