import { Link } from 'react-router-dom'
import { Wrap, H2, Lead } from './ui.jsx'
import { Wordmark } from './Footer.jsx'
import { useDocumentTitle } from './title.js'

export default function NotFound() {
  useDocumentTitle('Page not found · Udaan')
  return (
    <section className="grid min-h-[78vh] place-items-center bg-[#f6f6ef] pb-16 pt-28">
      <Wrap className="text-center">
        <img src="/logo/udaan-black.png" alt="" className="mx-auto h-12" />
        <Wordmark className="mt-4 block text-[12px] text-ink/45" />
        <H2 className="mt-8">That page isn’t here.</H2>
        <Lead className="mx-auto mt-3 max-w-sm">The link may be old, or the address may have a typo.</Lead>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/" className="rounded-full bg-brand px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark">Back to Udaan</Link>
          <Link to="/download" className="rounded-full px-5 py-2.5 text-[14px] font-semibold text-ink/75 hover:text-ink">Download</Link>
        </div>
      </Wrap>
    </section>
  )
}
