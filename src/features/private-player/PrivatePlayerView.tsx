import { useState } from 'react'
import { motion } from 'framer-motion'
import { DiscIcon } from '@/shared/icons'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { usePlayer, useLibrary } from './lib/PlayerContext'
import { MiniPlayer } from './components/MiniPlayer'
import { NowPlayingView } from './components/NowPlayingView'
import { LibraryPanel } from './components/LibraryPanel'
import { HomePanel } from './components/HomePanel'
import { SearchPanel } from './components/SearchPanel'
import { PlaylistsPanel } from './components/PlaylistsPanel'
import { QueueDrawer } from './components/QueueDrawer'
import { SoundBars } from './components/SoundBars'
import type { AudioTrack } from './lib/types'

interface PrivatePlayerViewProps {
  /** Part of BaseAppProps (AppHost always passes it) — unused here now
   *  that AppTitleBar is the one shared close affordance every app view
   *  uses, kept for contract consistency. */
  onClose: () => void
}

type NavView = 'home' | 'search' | 'library' | 'playlists'

/**
 * Private Player, ported: same playback mechanics (single audio element,
 * modulo-wrapped queue, random-pick shuffle, single-track repeat, hand-
 * rolled scrubber) as the original Next.js app, streamed via Tauri's asset
 * protocol against the same on-disk MP3 folder rather than served by a web
 * server. Visually rebuilt to Udaan's flat --surface-base / border-hairline /
 * text-primary/secondary/tertiary language — no frosted glass, no new
 * colors invented, matching Notes/Document Reader.
 *
 * The playback engine and library scan both come from PlayerContext (see
 * lib/PlayerContext.tsx) — mounted once at App.tsx's root, NOT here — so
 * closing/reopening this overlay never creates a second audio element or
 * re-scans the folder, and playback keeps going while the overlay is
 * closed (surfaced app-wide via the TopBar's NowPlayingChip).
 */
export function PrivatePlayerView(_props: PrivatePlayerViewProps) {
  const engine = usePlayer()
  const library = useLibrary()
  const [nav, setNav] = useState<NavView>('home')
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  function handlePlayTrack(index: number) {
    engine.setQueue(library.tracks, index)
  }

  function handlePlayQueue(tracksToPlay: AudioTrack[], startIndex: number) {
    engine.setQueue(tracksToPlay, startIndex)
  }

  function handleReorderQueue(next: AudioTrack[]) {
    engine.updateQueueOrder(next, engine.current?.path ?? null)
  }

  function handleRemoveFromQueue(index: number) {
    const next = engine.queue.filter((_, i) => i !== index)
    if (next.length === 0) return
    if (index === engine.currentIndex) {
      // Removing the playing track: fall through to whatever now sits at
      // that position and actually start it, unlike a plain reorder.
      engine.setQueue(next, Math.min(index, next.length - 1))
    } else {
      engine.updateQueueOrder(next, engine.current?.path ?? null)
    }
  }

  return (
    <div className="relative flex h-full w-full" style={{ backgroundColor: 'var(--surface-base)' }}>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Keeps its own shape rather than ViewHeader — the nav sits in
            the middle of this row, which that component has no slot for.
            The typography and the absent hard rule follow it, though: a
            full-width border across the top of a frosted panel was the
            boxiest thing left in the app. */}
        <div className="flex shrink-0 items-center justify-between gap-6 px-6 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <DiscIcon width={16} height={16} className="text-text-tertiary" />
            <h1 className="text-text-primary text-[15px] font-semibold tracking-tight">
              Private Player
            </h1>
            {engine.isPlaying && (
              <SoundBars analyser={engine.analyser} isPlaying={engine.isPlaying} barCount={10} className="ml-1 h-4 w-8 shrink-0" />
            )}
          </div>
          {!nowPlayingOpen && (
            <nav className="flex shrink-0 items-center gap-5">
              <NavButton label="Home" active={nav === 'home'} onClick={() => setNav('home')} />
              <NavButton label="Search" active={nav === 'search'} onClick={() => setNav('search')} />
              <NavButton label="Library" active={nav === 'library'} onClick={() => setNav('library')} />
              <NavButton label="Playlists" active={nav === 'playlists'} onClick={() => setNav('playlists')} />
            </nav>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {nowPlayingOpen ? (
            <NowPlayingView onCollapse={() => setNowPlayingOpen(false)} />
          ) : library.loading ? (
            <div className="flex h-full items-center justify-center">
              <span className="text-text-tertiary text-sm">Loading library…</span>
            </div>
          ) : nav === 'home' ? (
            <HomePanel
              tracks={library.tracks}
              currentTrackPath={engine.current?.path ?? null}
              isPlaying={engine.isPlaying}
              onPlayTrack={handlePlayTrack}
              onPlayQueue={handlePlayQueue}
            />
          ) : nav === 'search' ? (
            <SearchPanel
              tracks={library.tracks}
              currentTrackPath={engine.current?.path ?? null}
              isPlaying={engine.isPlaying}
              onPlayTrack={handlePlayTrack}
            />
          ) : nav === 'library' ? (
            <LibraryPanel
              tracks={library.tracks}
              currentTrackPath={engine.current?.path ?? null}
              isPlaying={engine.isPlaying}
              onPlayTrack={handlePlayTrack}
              onChooseFolder={library.chooseFolder}
              musicFolder={library.musicFolder}
              onAddFiles={library.addFiles}
              importing={library.importing}
            />
          ) : (
            <PlaylistsPanel tracks={library.tracks} onPlayQueue={(tracks, index) => engine.setQueue(tracks, index)} />
          )}
        </div>

        {/* Hidden while Now Playing is expanded — it's a full replacement
            for the mini bar, not a layer on top of it. The mini bar showing
            underneath the expanded view (its play/pause row visible right
            below the expanded controls) was a reported layout bug. */}
        {!nowPlayingOpen && (
          <MiniPlayer
            track={engine.current}
            isPlaying={engine.isPlaying}
            currentTime={engine.currentTime}
            duration={engine.duration}
            volume={engine.volume}
            analyser={engine.analyser}
            onTogglePlay={engine.togglePlay}
            onNext={engine.next}
            onPrev={engine.prev}
            onSeek={engine.seek}
            onSetVolume={engine.setVolume}
            onOpenNowPlaying={() => setNowPlayingOpen(true)}
            onToggleQueue={() => setQueueOpen((v) => !v)}
          />
        )}
      </div>

      <QueueDrawer
        open={queueOpen}
        queue={engine.queue}
        currentIndex={engine.currentIndex}
        onReorder={handleReorderQueue}
        onJumpTo={engine.playAt}
        onRemove={handleRemoveFromQueue}
        onClose={() => setQueueOpen(false)}
      />
    </div>
  )
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const reduced = prefersReducedMotion()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="relative py-1 text-xs font-medium"
    >
      <span className={active ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary transition-colors duration-150'}>
        {label}
      </span>
      {active && (
        <motion.span
          layoutId="private-player-nav-active"
          className="bg-accent absolute inset-x-0 -bottom-0.5 h-[1.5px] rounded-full"
          transition={reduced ? { duration: 0 } : spring.panel}
        />
      )}
    </button>
  )
}
