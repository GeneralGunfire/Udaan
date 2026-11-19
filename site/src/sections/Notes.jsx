import { Reveal, Wrap, Eyebrow, H2, Lead, win, Parallax } from '../ui.jsx'

const CARDS = [
  ['Markdown that just works', 'Bold, headings, lists and checklists, with a toolbar if you prefer buttons to symbols.'],
  ['Tags that group themselves', 'Type #travel in a note and it joins a tag you can filter by.'],
  ['Write, split or read', 'Edit on one side and see the result on the other, or switch to a clean reading view.'],
  ['Saved as you type', 'No Save button. Pin, copy or export a note whenever you like.'],
]

/* Layout: centred heading, one wide window, then four small cards underneath. */
export default function Notes() {
  return (
    <section id="notes" className="bg-white py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal from="down">
          <Eyebrow>Notes</Eyebrow>
          <H2 className="mt-3">Write it down.</H2>
          <Lead className="mx-auto mt-4 max-w-lg">A fast, plain notes app for lists, ideas and anything you want to find again.</Lead>
        </Reveal>
        <Reveal delay={0.05} from="rise" className="mx-auto mt-6 max-w-[860px]">
          <Parallax amount={12}><img src={win('notes')} alt="The Notes app in split view, with a Markdown note and its preview" className="mx-auto w-full" /></Parallax>
        </Reveal>
        <div className="mx-auto -mt-4 grid max-w-[920px] gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.08}>
              <div className="lift h-full rounded-[18px] bg-[#f6f6ef] p-5">
                <p className="text-[14.5px] font-semibold">{t}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Wrap>
    </section>
  )
}
