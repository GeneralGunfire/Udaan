import { useVideoEditorState } from './lib/useVideoEditorState'
import { useVideoAssetFolder } from './lib/useVideoAssetFolder'
import { ClipLibrary } from './components/ClipLibrary'
import { PreviewPane } from './components/PreviewPane'
import { Timeline } from './components/Timeline'
import { ExportPanel } from './components/ExportPanel'
import { FilmIcon } from '@/shared/icons'

/**
 * Video Editor — UI shell only, per the task brief. Timeline, preview,
 * clip library, and export panel all exist and are wired to real local
 * state, but no video is decoded, previewed, trimmed, or exported for
 * real. Every place real processing would plug in is marked with a TODO
 * pointing at NOTES.md, where the engine choice is flagged as needing
 * direct user input (hardware constraints).
 */
export function VideoEditorView() {
  const state = useVideoEditorState()
  const library = useVideoAssetFolder()

  const selectedClip = state.clips.find((c) => c.id === state.selectedClipId) ?? null

  return (
    <div className="flex h-full w-full max-w-[1400px] flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FilmIcon width={16} height={16} className="text-accent-creativity" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">
            Video Editor
          </h1>
        </div>
        <span className="border-glass-border text-text-tertiary rounded-full border border-dashed px-2.5 py-1 text-[10px] font-medium tracking-wide uppercase">
          Foundation only — no real video processing yet
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_260px] gap-3">
        <ClipLibrary
          folderPath={library.folderPath}
          assets={library.assets}
          loading={library.loading}
          onPickFolder={library.pickFolder}
          onPickFiles={library.pickFiles}
          onAddClip={(asset) => state.addClip(asset)}
        />

        <PreviewPane
          selectedClipName={selectedClip?.fileName ?? null}
          playheadSeconds={state.playheadSeconds}
          totalDuration={state.totalDuration}
        />

        <ExportPanel
          settings={state.exportSettings}
          onChange={state.setExportSettings}
          hasClips={state.clips.length > 0}
        />
      </div>

      <Timeline
        clips={state.clips}
        selectedClipId={state.selectedClipId}
        onSelectClip={state.setSelectedClipId}
        onRemoveClip={state.removeClip}
        playheadSeconds={state.playheadSeconds}
        onScrub={state.setPlayheadSeconds}
        totalDuration={state.totalDuration}
      />
    </div>
  )
}
