import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Download as DownloadIcon, Undo2, ShieldCheck, Feather, ChevronDown, Laptop, Info } from 'lucide-react'
import { useDocumentTitle } from './title.js'
import { Monitor } from './Devices.jsx'
import { Reveal, Wrap, Eyebrow, H2, Lead, shot, ease } from './ui.jsx'
import { FAQ } from './faq.js'
import { useRelease } from './updates.js'

const KIND = { release: ['New version', 'bg-brand/10 text-brand'], fix: ['Bug fixes', 'bg-emerald-100 text-emerald-700'], news: ['Announcement', 'bg-amber-100 text-amber-700'] }

/* One installer per Windows version. The links come from public/latest.json; a null url keeps the button disabled. */
const INSTALLER_INFO = [
  { id: '11', name: 'Windows 11', blurb: 'For PCs running Windows 11.' },
  { id: '10', name: 'Windows 10', blurb: 'For PCs running Windows 10.' },
]

const FACTS = [
  [Undo2, 'Easy to undo', 'Turn off the Udaan dock in Settings and the Windows taskbar and Start come straight back.'],
  [ShieldCheck, 'Your files stay yours', 'Udaan changes how the desktop looks and works. It does not move or delete your files.'],
  [Feather, 'Built to stay light', 'Tested on an older desktop PC, not only on new hardware.'],
]

const DETAILS = [
  ['Version', 'Early access (not released yet)'],
  ['Works on', 'Windows 11 and Windows 10'],
  ['Installers', 'One for each Windows version'],
  ['Price', 'Free for friends'],
  ['Size', 'To be announced'],
]

/** Asks the browser which Windows this is. Only Chromium browsers can say; elsewhere it returns null and nothing is highlighted. */
function useWindowsVersion() {
  const [v, setV] = useState(null)
  useEffect(() => {
    const u = navigator.userAgentData
    if (!u?.getHighEntropyValues) return
    u.getHighEntropyValues(['platformVersion']).then((d) => {
      if (u.platform !== 'Windows') return
      setV(parseInt(d.platformVersion, 10) >= 13 ? '11' : '10') // the browser reports 13 and up for Windows 11
    }).catch(() => {})
  }, [])
  return v
}

function InstallerCard({ it, detected }) {
  const ready = Boolean(it.href)
  return (
    <div className={`relative rounded-[20px] border bg-white p-5 transition-shadow ${detected ? 'border-brand/40 shadow-[0_10px_30px_-14px_rgba(26,102,242,.35)]' : 'border-black/10'}`}>
      {detected && <span className="absolute -top-2.5 left-5 rounded-full bg-brand px-2.5 py-0.5 text-[11.5px] font-semibold text-white">Matches your PC</span>}
      <div className="flex items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f3f3ee] text-ink/70"><Laptop size={20} strokeWidth={1.7} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-tight">Udaan for {it.name}</p>
          <p className="mt-0.5 text-[13.5px] text-ink/55">{it.blurb}{it.size ? ` · ${it.size}` : ''}</p>
        </div>
        {ready ? (
          <a href={it.href} download className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-brand-dark"><DownloadIcon size={15} />Download</a>
        ) : (
          <button disabled className="inline-flex shrink-0 cursor-not-allowed items-center gap-2 rounded-full bg-ink/10 px-4 py-2.5 text-[13.5px] font-semibold text-ink/45"><DownloadIcon size={15} />Not yet</button>
        )}
      </div>
    </div>
  )
}

export default function Download() {
  useDocumentTitle('Download Udaan')
  const detected = useWindowsVersion()
  const release = useRelease()
  const LATEST_VERSION = release.version
  const UPDATES = release.updates
  const INSTALLERS = INSTALLER_INFO.map((i) => ({ ...i, href: release.installers?.[i.id]?.url ?? null, size: release.installers?.[i.id]?.size ?? null }))
  const ordered = detected ? [...INSTALLERS].sort((a, b) => (a.id === detected ? -1 : b.id === detected ? 1 : 0)) : INSTALLERS
  return (
    <>

        <section className="bg-[#f6f6ef] pb-16 pt-28 md:pb-20 md:pt-32">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 md:grid-cols-[0.95fr_1.05fr] md:px-10">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
              <Eyebrow>Download</Eyebrow>
              <h1 className="mt-3 text-[clamp(36px,4.2vw,54px)] font-semibold leading-[1.05] tracking-[-0.03em]">Get Udaan.</h1>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink/60">Free for friends during early access. There is a separate installer for Windows 11 and for Windows 10, so you get the one made for your PC.</p>

              <div id="installers" className="mt-8 space-y-3.5" role="list" aria-label="Installers">
                {ordered.map((it, k) => (
                  <motion.div key={it.id} role="listitem" layout transition={{ duration: 0.4, ease }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                    <InstallerCard it={it} detected={detected === it.id} />
                  </motion.div>
                ))}
              </div>
              <p className="mt-4 text-[13.5px] text-ink/55">Not available yet. Early access opens soon, and the downloads will appear here.</p>

              <details className="group mt-5 max-w-md rounded-2xl bg-white/70 px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold"><Info size={15} className="text-ink/45" />Not sure which one you need?<ChevronDown size={15} className="ml-auto text-ink/40 transition-transform group-open:rotate-180" /></summary>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink/60">Open Settings, then System, then About. Under “Windows specifications” it says Windows 10 or Windows 11. If it says Windows 11, pick the Windows 11 installer.</p>
              </details>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.1 }}>
              <Monitor>
                <img src={shot('b-desktop')} alt="The Udaan desktop on a monitor" className="absolute inset-0 h-full w-full object-cover" />
              </Monitor>
            </motion.div>
          </div>
        </section>

        <section className="bg-white py-20 md:py-24">
          <Wrap className="grid gap-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-14">
            <Reveal from="left">
              <Eyebrow>At a glance</Eyebrow>
              <H2 className="mt-3">What you will get.</H2>
              <dl className="mt-7 divide-y divide-black/10 border-y border-black/10">
                {DETAILS.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-6 py-3.5">
                    <dt className="text-[14px] text-ink/50">{k}</dt>
                    <dd className="text-right text-[15px] font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[13px] text-ink/45">System requirements will be added when early access opens.</p>
            </Reveal>

            <Reveal delay={0.08} from="right">
              <ul className="space-y-3">
                {FACTS.map(([Icon, t, d]) => (
                  <li key={t} className="lift flex gap-4 rounded-[20px] bg-[#f6f6ef] p-5">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink/70 shadow-[0_1px_2px_rgba(0,0,0,.08)]"><Icon size={17} strokeWidth={1.8} /></span>
                    <span><span className="block text-[15.5px] font-semibold">{t}</span><span className="mt-0.5 block text-[14px] leading-relaxed text-ink/55">{d}</span></span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </Wrap>
        </section>

        <section id="updates" className="bg-[#f6f6ef] py-20 md:py-24">
          <Wrap className="max-w-3xl">
            <Reveal>
              <Eyebrow>Updates</Eyebrow>
              <H2 className="mt-3">What's new.</H2>
              <p className="mt-3 text-[15px] text-ink/60">Latest version: <b className="text-ink">{LATEST_VERSION}</b>. Already installed? Udaan checks for updates by itself and keeps your settings. To check right now, open the app from the button below.</p>
              <a href="udaan://check-update" className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-ink/85">Check my version</a>
              <p className="mt-2 text-[12.5px] text-ink/45">Your browser will ask to open Udaan. If nothing happens, Udaan is not installed on this PC yet.</p>
            </Reveal>
            <ol className="mt-8 space-y-4">
              {UPDATES.map((u) => {
                const [label, tone] = KIND[u.kind]
                return (
                  <Reveal key={u.date + u.title} from="up">
                    <li className="lift rounded-[20px] bg-white p-5">
                      <div className="flex flex-wrap items-center gap-2.5 text-[12.5px]">
                        <span className={`rounded-full px-2.5 py-0.5 font-semibold ${tone}`}>{label}</span>
                        {u.version && <span className="font-semibold text-ink/70">Version {u.version}</span>}
                        <span className="text-ink/45">{new Date(u.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                      </div>
                      <p className="mt-2 text-[16.5px] font-semibold leading-snug">{u.title}</p>
                      {u.body && <p className="mt-1 text-[14.5px] leading-relaxed text-ink/60">{u.body}</p>}
                      {u.notes && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[14.5px] text-ink/60">{u.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                      {u.kind === 'release' && u.version === LATEST_VERSION && (
                        <a href="#installers" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline"><DownloadIcon size={14} />Get this version</a>
                      )}
                    </li>
                  </Reveal>
                )
              })}
            </ol>
          </Wrap>
        </section>

        <section id="faq" className="bg-white py-20 md:py-24">
          <Wrap className="max-w-3xl">
            <Reveal><H2 className="text-[clamp(26px,2.6vw,34px)]">Before you download</H2></Reveal>
            <div className="mt-8 divide-y divide-black/10 border-y border-black/10">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
                    {q}<ChevronDown size={18} className="shrink-0 text-ink/40 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink/60">{a}</p>
                </details>
              ))}
            </div>
            <Lead className="mt-8 text-[15px]">Want to see it first? <Link to="/" className="font-semibold text-brand hover:underline">Back to the tour</Link>.</Lead>
          </Wrap>
        </section>
    </>
  )
}
