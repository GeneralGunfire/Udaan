import { MotionConfig, motion } from 'framer-motion'
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Nav from './Nav.jsx'
import Footer from './Footer.jsx'

/** On a new page, start at the top. On a link with a #section, glide to that section once the page has drawn. */
function ScrollManager() {
  const { pathname, hash, key } = useLocation()
  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1))
      const go = () => document.getElementById(id)?.scrollIntoView({ block: 'start' })
      const raf = requestAnimationFrame(go)
      // Pictures above the section can change the page height after we scroll. Check twice and correct if we are off.
      const fix = () => {
        const el = document.getElementById(id)
        if (el && Math.abs(el.getBoundingClientRect().top - 72) > 14) el.scrollIntoView({ block: 'start' })
      }
      const t1 = setTimeout(fix, 1300), t2 = setTimeout(fix, 2600)
      return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2) }
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash, key])
  return null
}

/** The frame around every page: top bar, a short fade between pages, and the footer. */
export default function Layout() {
  const { pathname } = useLocation()
  return (
    <MotionConfig reducedMotion="user">
      <div className="overflow-x-clip">
        <ScrollManager />
        <Nav />
        <motion.main key={pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
          <Outlet />
        </motion.main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
