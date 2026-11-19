import { ChevronDown, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Wordmark } from '../Footer.jsx'
import { Reveal, Wrap, H2, Lead } from '../ui.jsx'
import { FAQ } from '../faq.js'

export default function Early() {
  return (
    <>
      <section id="early" className="bg-[#f6f6ef] py-20 text-center md:py-24">
        <Wrap>
          <Reveal from="zoom">
            <img src="/logo/udaan-black.png" alt="" className="mx-auto h-12" />
            <Wordmark className="mt-3 block text-[12px] text-ink/50" />
            <H2 className="mt-7">Be one of the first.</H2>
            <Lead className="mx-auto mt-4 max-w-md">Free for friends during early access, with a separate installer for Windows 11 and Windows 10.</Lead>
            <Link to="/download" className="group mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-[14.5px] font-semibold text-white transition hover:bg-brand-dark">
              Go to downloads <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="mt-3 text-[13px] text-ink/45">Downloads are not live yet. This page is a preview.</p>
          </Reveal>
        </Wrap>
      </section>

      <section id="faq" className="bg-white py-20 md:py-24">
        <Wrap className="max-w-3xl">
          <Reveal><H2 className="text-[clamp(26px,2.6vw,34px)]">Questions</H2></Reveal>
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
        </Wrap>
      </section>
    </>
  )
}
