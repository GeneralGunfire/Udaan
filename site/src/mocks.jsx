import { motion } from 'framer-motion'
import { Folder, Globe, Music2, Tv, Settings, MessageCircle, Search, Calendar, Layers, Play, Plus, Wifi, Battery, Terminal, Image as Img, Mail, LayoutGrid } from 'lucide-react'

const wall = { backgroundImage: 'url(/wall-blue.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }
export const Wall = ({ className = '', children }) => (
  <div className={`relative overflow-hidden ${className}`} style={wall}>{children}</div>
)

export const Frame = ({ title, children, className = '' }) => (
  <div className={`rounded-2xl overflow-hidden bg-[#0d0e11]/90 border border-white/15 shadow-[0_40px_90px_-20px_rgba(0,0,0,.7)] ${className}`}>
    <div className="h-9 flex items-center gap-2 px-4 bg-white/[.06] border-b border-white/10">
      {['#ff5f57', '#febc2e', '#28c840'].map(c => <i key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />)}
      <span className="mx-auto text-[11px] text-white/60 font-medium -translate-x-4">{title}</span>
    </div>
    {children}
  </div>
)

export const TopBar = () => (
  <div className="absolute top-0 inset-x-0 h-7 px-4 flex items-center gap-4 text-[10px] text-white/85 bg-black/25 backdrop-blur-xl">
    <img src="/os_logo_small_size.png" className="h-3.5" /><b>Udaan</b><span>File</span><span>Edit</span><span>View</span>
    <span className="ml-auto flex gap-3 items-center"><Wifi size={11} /><Battery size={12} />Tue 10:42</span>
  </div>
)

const dockIcons = [LayoutGrid, Folder, Globe, MessageCircle, Music2, Tv, Terminal, Settings]
export const Dock = ({ className = '' }) => (
  <div className={`glass rounded-[22px] px-3 py-2.5 flex gap-2.5 ${className}`}>
    {dockIcons.map((I, i) => (
      <motion.div key={i} whileHover={{ y: -8, scale: 1.25 }} className="w-11 h-11 rounded-xl grid place-items-center text-white bg-gradient-to-b from-white/25 to-white/5 border border-white/20"><I size={20} /></motion.div>
    ))}
  </div>
)

export const Desktop = ({ className = '' }) => (
  <Wall className={`rounded-2xl aspect-[16/10] ${className}`}>
    <TopBar />
    <Frame title="Files" className="absolute left-[7%] top-[16%] w-[46%]">
      <div className="p-4 grid grid-cols-4 gap-3">
        {['Docs', 'Music', 'Pictures', 'Projects', 'Videos', 'Games', 'Notes', 'Backups'].map(n => (
          <div key={n} className="text-center text-[9px] text-white/70"><Folder className="mx-auto mb-1 text-blue" fill="#3072f0" size={28} />{n}</div>
        ))}
      </div>
    </Frame>
    <Frame title="Chat" className="absolute right-[6%] top-[26%] w-[34%]">
      <div className="p-4 space-y-2 text-[10px]">
        <div className="bg-white/10 rounded-xl p-2 text-white/80 w-4/5">Summarise my week.</div>
        <div className="bg-blue rounded-xl p-2 text-white ml-auto w-4/5">Three deadlines, one free evening. Want a plan?</div>
      </div>
    </Frame>
    <Dock className="absolute bottom-3 left-1/2 -translate-x-1/2 scale-[.8]" />
  </Wall>
)

const apps = [['Files', Folder], ['Chat', MessageCircle], ['Browser', Globe], ['Studio', Music2], ['Calendar', Calendar]]
export const Switcher3D = ({ className = '' }) => (
  <Wall className={`rounded-2xl aspect-[16/10] ${className}`}>
    <div className="absolute inset-0 bg-black/40" />
    <div className="absolute inset-0" style={{ perspective: 1100 }}>
      <div className="relative w-full h-full" style={{ transformStyle: 'preserve-3d' }}>
        {apps.map(([t, I], i) => {
          const o = i - 2
          return (
            <motion.div key={t} whileHover={{ y: -14 }} className="absolute left-1/2 top-1/2 w-[34%] aspect-[4/3] -ml-[17%] -mt-[13%] rounded-xl glass overflow-hidden"
              style={{ transform: `translateX(${o * 62}%) translateZ(${-Math.abs(o) * 130}px) rotateY(${-o * 28}deg)` }}>
              <div className="h-6 bg-white/10 flex items-center px-2 gap-1.5 text-[9px] text-white"><I size={10} />{t}</div>
              <div className="p-3 space-y-2">{[80, 60, 70].map(w => <i key={w} className="block h-2 rounded bg-white/20" style={{ width: w + '%' }} />)}</div>
            </motion.div>
          )
        })}
      </div>
    </div>
    <div className="absolute bottom-4 inset-x-0 text-center text-white/70 text-[10px] tracking-widest uppercase">Double-tap Ctrl</div>
  </Wall>
)

const posters = ['#3072f0', '#6d28d9', '#0f766e', '#b45309', '#be123c', '#1d4ed8', '#334155', '#7c3aed']
export const TVApp = ({ className = '' }) => (
  <Frame title="TV" className={className}>
    <div className="relative h-44 overflow-hidden" style={{ background: 'linear-gradient(120deg,#0b1d4d,#3072f0 60%,#9bbcff)' }}>
      <div className="absolute left-6 bottom-5 text-white">
        <div className="display text-3xl">Midnight Signal</div>
        <div className="text-[10px] text-white/70 mb-2">Sci-fi · 2h 04m</div>
        <span className="inline-flex items-center gap-1 bg-white text-black text-[10px] font-semibold rounded-full px-3 py-1"><Play size={10} fill="#000" />Play</span>
      </div>
    </div>
    <div className="p-4 space-y-3">
      {['Continue watching', 'Trending'].map((r, k) => (
        <div key={r}><div className="text-[10px] text-white/60 mb-1.5">{r}</div>
          <div className="flex gap-2">{posters.slice(k * 3, k * 3 + 5).map((c, i) => (
            <motion.div key={i} whileHover={{ y: -6, scale: 1.06 }} className="flex-1 aspect-[2/3] rounded-lg" style={{ background: `linear-gradient(160deg,${c},#0a0a0b)` }} />
          ))}</div>
        </div>
      ))}
    </div>
  </Frame>
)

export const StartMenu = ({ className = '' }) => (
  <div className={`glass rounded-3xl p-5 w-[300px] text-white ${className}`}>
    <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-2 text-xs text-white/70 mb-4"><Search size={13} />Search apps, files, settings</div>
    <div className="grid grid-cols-4 gap-3">
      {[Folder, Globe, MessageCircle, Music2, Tv, Mail, Calendar, Img, Terminal, Layers, Settings, Plus].map((I, i) => (
        <div key={i} className="aspect-square rounded-2xl bg-white/10 grid place-items-center"><I size={20} /></div>
      ))}
    </div>
  </div>
)
