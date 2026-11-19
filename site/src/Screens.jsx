import { Desktop, Switcher3D, Dock, Wall } from './mocks.jsx'
import { Play } from 'lucide-react'

/* Full-bleed screen contents that fill a device. Swap any of these for a real screenshot later:
   <img src="/shots/x.png" className="w-full h-full object-cover" /> */
export const DesktopScreen = () => <Desktop className="!aspect-auto !rounded-none w-full h-full" />
export const SwitcherScreen = () => <Switcher3D className="!aspect-auto !rounded-none w-full h-full" />

const cols = ['#2f7bff', '#7c3aed', '#0f766e', '#b45309', '#be123c', '#1d4ed8', '#334155', '#0891b2']
export const TVScreen = () => (
  <div className="w-full h-full bg-[#0b0d12] text-white flex flex-col overflow-hidden">
    <div className="relative flex-1" style={{ background: 'linear-gradient(110deg,#07163f,#2f7bff 65%,#a8c6ff)' }}>
      <div className="absolute left-[6%] bottom-[14%]">
        <div className="text-[min(4.2vw,44px)] font-semibold tracking-tight leading-none">Midnight Signal</div>
        <div className="text-xs text-white/70 mt-1 mb-3">Sci-fi · 2h 04m</div>
        <span className="inline-flex items-center gap-1.5 bg-white text-black text-xs font-semibold rounded px-4 py-1.5"><Play size={12} fill="#000" />Play</span>
      </div>
    </div>
    <div className="flex gap-2 p-3 bg-[#0b0d12]">
      {cols.map((c, i) => <div key={i} className="flex-1 aspect-[3/4] rounded-md" style={{ background: `linear-gradient(160deg,${c},#06080c)` }} />)}
    </div>
  </div>
)
export { Dock, Wall }
