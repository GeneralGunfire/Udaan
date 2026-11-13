import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/shared/components/ui/button'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { useStudioStore } from '../store/studioStore'
import { TransportBar } from './TransportBar'
import { Arrangement } from './Arrangement'
import { Mixer } from './Mixer'
import { Browser } from './Browser'
import { PianoRoll } from './PianoRoll'
import { StepSequencer } from './StepSequencer'
import { instrumentById } from '../instruments/definitions'
import { AudioSetup } from './AudioSetup'
import { PlayKeyboard } from './PlayKeyboard'

/**
 * Studio's shell: transport across the top, browser at the left, the
 * workspace in the middle, and the mixer or an editor below.
 *
 * ## Why the editor and mixer share one region
 * Both are reference surfaces you consult while looking at the
 * arrangement above, and screens are not tall enough to give each its own
 * permanent band without squeezing the arrangement to a strip. They share
 * the lower panel and swap by tab, which is also how they are actually
 * used — you are either editing a part or balancing the mix, rarely both
 * in the same second.
 *
 * ## Keyboard shortcuts are registered here, once
 * Space and the rest are global to Studio, so they live at the shell
 * rather than being re-bound by every panel that happens to have focus.
 * They are skipped whenever a text field has focus, since typing "s" in a
 * track name must not solo the track.
 */
// `onClose` is part of BaseAppProps (AppHost always passes it) but this
// view no longer needs its own close button — AppTitleBar is now the one
// shared close affordance every app view uses.
export function StudioApp(_props: { onClose: () => void }) {
  const initialize = useStudioStore((s) => s.initialize)
  const shutdown = useStudioStore((s) => s.shutdown)
  const error = useStudioStore((s) => s.error)
  const setError = useStudioStore((s) => s.setError)
  const panels = useStudioStore((s) => s.panels)
  const togglePanel = useStudioStore((s) => s.togglePanel)
  const editorTab = useStudioStore((s) => s.editorTab)
  const setEditorTab = useStudioStore((s) => s.setEditorTab)
  const tracks = useStudioStore((s) => s.project.tracks)
  const selectedTrackId = useStudioStore((s) => s.selectedTrackId)
  const selectedClipId = useStudioStore((s) => s.selectedClipId)
  const hasCompletedSetup = useStudioStore((s) => s.hasCompletedSetup)
  const [setupOpen, setSetupOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    void initialize()
    return () => {
      void shutdown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useShortcuts()

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null
  // Narrowed explicitly: `find` on a union returns the union, and the
  // editors below only accept a MidiClip. An audio clip selected in the
  // arrangement simply has no note editor, which is correct.
  const selectedClipRaw = selectedTrack?.clips.find((c) => c.id === selectedClipId)
  const selectedClip =
    selectedClipRaw && selectedClipRaw.kind === 'midi' ? selectedClipRaw : null
  const instrument = selectedTrack?.instrumentId
    ? instrumentById(selectedTrack.instrumentId)
    : undefined
  const isDrumTrack = Boolean(instrument?.drumMap?.length)

  return (
    <TooltipProvider delayDuration={400}>
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : spring.gentle}
        className="flex h-full min-h-0 w-full flex-col"
        style={{ background: 'var(--surface-base)' }}
      >
        <div className="flex shrink-0 items-center border-b border-(--border-hairline)">
          <div className="min-w-0 flex-1">
            <TransportBar />
          </div>
          <div className="flex shrink-0 items-center gap-1 pr-3">
            <PanelToggle
              label="Browser"
              active={panels.browser}
              onClick={() => togglePanel('browser')}
            />
            <PanelToggle label="Mixer" active={panels.mixer} onClick={() => togglePanel('mixer')} />
            <PanelToggle
              label="Keys"
              active={keyboardOpen}
              onClick={() => setKeyboardOpen((v) => !v)}
            />
            <PanelToggle label="Audio" active={setupOpen} onClick={() => setSetupOpen((v) => !v)} />
          </div>
        </div>

        {setupOpen || !hasCompletedSetup ? (
          <AudioSetup
            onDone={() => {
              setSetupOpen(false)
              // Marked complete by the wizard itself when settings are
              // applied; doing it here too covers "skip for now", so the
              // wizard does not reappear on every open.
              useStudioStore.getState().markSetupComplete()
            }}
          />
        ) : (
        <div className="flex min-h-0 flex-1">
          <AnimatePresence initial={false}>
            {panels.browser && (
              <motion.aside
                key="browser"
                initial={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
                animate={{ width: 260, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
                transition={reduced ? { duration: 0 } : spring.panel}
                className="shrink-0 overflow-hidden border-r border-(--border-hairline)"
              >
                <div className="w-[260px]">
                  <Browser />
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {tracks.length === 0 ? <EmptyProject /> : <Arrangement />}

            <AnimatePresence initial={false}>
              {panels.mixer && (
                <motion.div
                  key="lower"
                  initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={{ height: 260, opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={reduced ? { duration: 0 } : spring.panel}
                  className="flex shrink-0 flex-col overflow-hidden border-t border-(--border-hairline)"
                >
                  <div className="flex shrink-0 items-center gap-0.5 px-3 pt-2">
                    <LowerTab
                      label="Mixer"
                      active={editorTab !== 'pianoRoll' && editorTab !== 'stepSequencer'}
                      onClick={() => setEditorTab('automation')}
                    />
                    {selectedClip && (
                      <LowerTab
                        label={isDrumTrack ? 'Steps' : 'Piano Roll'}
                        active={editorTab === 'pianoRoll' || editorTab === 'stepSequencer'}
                        onClick={() => setEditorTab(isDrumTrack ? 'stepSequencer' : 'pianoRoll')}
                      />
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1">
                    {(editorTab === 'pianoRoll' || editorTab === 'stepSequencer') &&
                    selectedClip &&
                    selectedTrack ? (
                      isDrumTrack ? (
                        <StepSequencer track={selectedTrack} clip={selectedClip} />
                      ) : (
                        <PianoRoll track={selectedTrack} clip={selectedClip} />
                      )
                    ) : (
                      <Mixer />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Play surface. Collapsed by default so it does not eat
                arrangement height, but one click away — for anyone
                without a MIDI controller this is how notes get played at
                all, so it is not buried in a menu. */}
            {keyboardOpen && selectedTrack?.kind === 'instrument' && (
              <motion.div
                initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={reduced ? { duration: 0 } : spring.panel}
                className="shrink-0 overflow-hidden border-t border-(--border-hairline)"
              >
                <PlayKeyboard track={selectedTrack} />
              </motion.div>
            )}
          </div>
        </div>
        )}

        {/* Errors are a strip rather than a modal: an audio problem is
            almost always something you fix while continuing to work, and
            a dialog would block the very controls needed to fix it. */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={spring.standard}
              role="alert"
              className="bg-danger/12 border-danger/25 flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5"
            >
              <span className="text-danger min-w-0 flex-1 truncate text-xs">{error}</span>
              <Button type="button" variant="ghost" size="pill-sm" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </TooltipProvider>
  )
}

function EmptyProject() {
  const addTrack = useStudioStore((s) => s.addTrack)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-text-primary text-xl font-light tracking-tight">
          Nothing here yet
        </h2>
        <p className="text-text-tertiary max-w-sm text-sm leading-relaxed">
          Start with drums and build up, or pick any instrument from the browser.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="brand"
          size="pill"
          onClick={() => addTrack('instrument', 'Drums', 'drums-808')}
        >
          Start with drums
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="pill"
          onClick={() => addTrack('instrument', 'Grand Piano', 'piano')}
        >
          Start with piano
        </Button>
      </div>
    </div>
  )
}

function PanelToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-150',
        active
          ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05]',
      )}
    >
      {label}
    </button>
  )
}

function LowerTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150',
        active
          ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05]',
      )}
    >
      {label}
    </button>
  )
}

/**
 * Studio's global keyboard shortcuts.
 *
 * Deliberately the set every DAW shares — Space to play, Ctrl+Z to undo,
 * M and S for mute and solo. Inventing a different vocabulary would make
 * the app harder to use for anyone who has touched another DAW, and no
 * easier for anyone who has not.
 */
function useShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      // Never intercept while typing: "s" belongs to the track name field
      // it was typed into, not to the solo button.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      const store = useStudioStore.getState()
      const meta = e.ctrlKey || e.metaKey

      if (e.code === 'Space') {
        e.preventDefault()
        void store.togglePlay()
        return
      }
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        void store.stopAndRewind()
        return
      }

      const track = store.project.tracks.find((t) => t.id === store.selectedTrackId)
      if (!track) return

      if (e.key.toLowerCase() === 'm') {
        e.preventDefault()
        store.updateTrack(track.id, { muted: !track.muted })
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        store.updateTrack(track.id, { soloed: !track.soloed })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
