import { Link } from 'react-router-dom'

const COLUMNS = [
  ['Explore', [['Apps', '/#apps'], ['Start', '/#start'], ['Window switcher', '/#switcher'], ['Files', '/#files'], ['Storage', '/#storage'], ['TV', '/#tv']]],
  ['Make it yours', [['News', '/#news'], ['Notes', '/#notes'], ['Settings', '/#settings'], ['Looks and screensavers', '/#yours'], ['Windows, side by side', '/#windows'], ['Private', '/#private']]],
  ['Get Udaan', [['Download', '/download'], ['Windows 11 and Windows 10', '/download#installers'], ['Updates and news', '/download#updates'], ['Questions', '/#faq']]],
]

/** Wordmark in the same tracked capitals as the Udaan boot screen. */
export const Wordmark = ({ className = '' }) => (
  <span className={`font-light uppercase tracking-[0.5em] ${className}`}>Udaan</span>
)

export default function Footer() {
  return (
    <footer className="overflow-hidden border-t border-black/5 bg-[#f6f6ef] text-[14px] text-ink/60">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 pb-12 pt-14 md:grid-cols-[1.3fr_1fr_1fr_1fr] md:px-10">
        <div>
          <Link to="/" className="inline-flex items-center gap-2.5 text-[20px] font-semibold tracking-tight text-ink">
            <img src="/logo/udaan-black.png" alt="" className="h-7" />Udaan
          </Link>
          <p className="mt-3 max-w-[240px] text-[14px] leading-relaxed">A desktop built around you. A glass-smooth shell for Windows 10 and 11.</p>
        </div>
        {COLUMNS.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink/80">{title}</p>
            <ul className="mt-4 space-y-2.5">
              {links.map(([label, to]) => (
                <li key={label}><Link to={to} className="transition-colors hover:text-ink">{label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div aria-hidden className="select-none whitespace-nowrap px-6 text-center text-[clamp(64px,17vw,210px)] font-light uppercase leading-[0.95] tracking-[0.14em] text-ink/[0.055] pb-3">Udaan</div>

      <div className="border-t border-black/5">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-6 py-6 text-[12.5px] text-ink/45 md:flex-row md:items-center md:justify-between md:px-10">
          <span>© 2026 Udaan. A desktop built around you.</span>
          <span>Windows is a trademark of Microsoft. Udaan is an independent project.</span>
        </div>
      </div>
    </footer>
  )
}
