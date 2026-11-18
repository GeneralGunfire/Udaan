import { useState, type ReactNode } from 'react'
import { usePref } from '@/os/kernel/prefs'
import { Slider } from '@/os/ui/controls'
import { Group, Row, Segmented, Switch } from './ui'

/**
 * Settings → Window Switcher. How the switcher is opened (drag up from the bottom edge, double-tap Ctrl) and how it
 * looks. Its animation style, speed and bounce are under Animations → Window switcher.
 */
export function SwitcherSettings(): ReactNode {
  const [drag, setDrag] = usePref('switcher.drag')
  const [percent, setPercent] = usePref('switcher.dragPercent')
  const [ctrl, setCtrl] = usePref('switcher.ctrl')
  const [gap, setGap] = usePref('switcher.ctrlGapMs')
  const [size, setSize] = usePref('switcher.size')
  // Sliders show the value as they move and save when let go (each save reaches every window).
  const [pDraft, setPDraft] = useState<number | null>(null)
  const [gDraft, setGDraft] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <Group title="Drag up from the bottom" footer="Press at the very bottom edge of the screen and drag upward. The switcher opens when you pass the line below; slide sideways to choose, release to open. It works over any app and the desktop, except full-screen apps.">
        <Row title="Open with a drag" description="Press at the bottom edge and drag up.">
          <Switch checked={drag} onChange={(v) => void setDrag(v)} label="Open with a drag" />
        </Row>
        {drag && (
          <Row title="How far to drag" description={`Up to ${pDraft ?? percent}% of the screen height. 50% is the middle of the screen.`}>
            <div className="flex w-[270px] shrink-0 items-center gap-3">
              <Slider aria-label="How far to drag" value={pDraft ?? percent} min={25} max={70} step={1} onChange={setPDraft} onCommit={() => pDraft !== null && void setPercent(pDraft).then(() => setPDraft(null))} className="flex-1" />
              <span className="w-10 text-right text-[12px] tabular-nums text-(--u-ink-3)">{pDraft ?? percent}%</span>
            </div>
          </Row>
        )}
      </Group>

      <Group title="Double-tap Ctrl" footer="Tap Ctrl twice quickly, with nothing else pressed. It works in any app and on the desktop. Ordinary Ctrl shortcuts and Ctrl+click never trigger it. Tap Ctrl twice again to close it.">
        <Row title="Open with a double-tap" description="Two quick taps of the Ctrl key.">
          <Switch checked={ctrl} onChange={(v) => void setCtrl(v)} label="Open with a double-tap" />
        </Row>
        {ctrl && (
          <Row title="Tap speed" description={`The two taps must be within ${gDraft ?? gap} ms. Longer is more forgiving; shorter avoids accidental opens.`}>
            <div className="flex w-[270px] shrink-0 items-center gap-3">
              <Slider aria-label="Tap speed" value={gDraft ?? gap} min={200} max={600} step={10} onChange={setGDraft} onCommit={() => gDraft !== null && void setGap(gDraft).then(() => setGDraft(null))} className="flex-1" />
              <span className="w-14 text-right text-[12px] tabular-nums text-(--u-ink-3)">{gDraft ?? gap} ms</span>
            </div>
          </Row>
        )}
      </Group>

      <Group title="Look" footer="Style, speed and bounce of the animation are in Animations → Window switcher. The flat strip is the lightest on the graphics card.">
        <Row title="Card size">
          <Segmented value={size} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} onChange={(v) => void setSize(v)} />
        </Row>
      </Group>
    </div>
  )
}
