import AppsCollage from '../AppsCollage.jsx'
import { Reveal, Wrap, H2, Lead } from '../ui.jsx'

export default function Apps() {
  return (
    <section id="apps" className="bg-white py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal from="blur"><H2>Everything you need, built in.</H2></Reveal>
        <Reveal delay={0.12}><Lead className="mx-auto mt-4 max-w-lg">Twelve apps made for Udaan, designed to feel like one system.</Lead></Reveal>
      </Wrap>
      <div className="mx-auto mt-8 max-w-[980px] px-4"><AppsCollage /></div>
    </section>
  )
}
