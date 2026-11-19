import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

const LINKS = [['Apps', 'apps'], ['Start', 'start'], ['Switcher', 'switcher'], ['Make it yours', 'yours'], ['Windows', 'windows'], ['Private', 'private']]

/** The top bar, on every page. On the home page the current section's link is darker. */
export default function Nav() {
  const { pathname } = useLocation()
  const home = pathname === '/'
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState('')

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    setActive('')
    if (!home) return
    const ids = LINKS.map(([, id]) => id)
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(ids.includes(e.target.id) ? e.target.id : '') }),
      { rootMargin: '-45% 0px -50% 0px' },
    )
    document.querySelectorAll('section[id]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [home])

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow] duration-300 ${scrolled ? 'bg-white/80 shadow-[0_1px_0_rgba(0,0,0,.06)] backdrop-blur-xl' : 'bg-transparent'}`}>
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-10 px-6 md:px-10">
        <Link to="/" aria-label="Udaan, home" className="flex items-center gap-2.5 text-[18px] font-semibold tracking-tight">
          <img src="/logo/udaan-black.png" alt="" className="h-6" />Udaan
        </Link>
        <nav className="hidden gap-6 text-[14px] lg:flex" aria-label="Sections">
          {LINKS.map(([n, id]) => (
            <Link key={id} to={`/#${id}`} className={`py-1 transition-colors ${active === id ? 'text-ink' : 'text-ink/60 hover:text-ink'}`}>{n}</Link>
          ))}
        </nav>
        <NavLink to="/download" className="ml-auto rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-black">Download</NavLink>
      </div>
    </header>
  )
}
