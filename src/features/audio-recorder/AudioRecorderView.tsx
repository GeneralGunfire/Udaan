import { RecordIcon, StopIcon, FolderIcon, ClockIcon } from '@/shared/icons'
import { useRecorder } from './hooks/useRecorder'
import { LiveWaveform } from './components/LiveWaveform'
import { RenamePrompt } from './components/RenamePrompt'
import { formatElapsed } from '@/shared/lib/formatElapsed'
import { ViewShell, ViewHeader } from '@/shared/components/ui/view'
import { RecentRecordings } from './components/RecentRecordings'

interface AudioRecorderViewProps {
  onClose: () => void
}

/**
 * System-audio recorder overlay: captures whatever is playing through the
 * PC's speakers/headphones (not the microphone) via WASAPI loopback,
 * encoding straight to high-quality MP3 in the user's Downloads folder.
 * See src-tauri/src/audio_recorder/mod.rs for the capture/encoding
 * pipeline and the reasoning behind its design (real-time streaming
 * encode for crash-safety, 3-minute silence auto-stop).
 */
// `onClose` is part of BaseAppProps (AppHost always passes it) but this
// view no longer needs its own close button — AppTitleBar (rendered by
// AppHost) is the one shared close affordance every app view uses now.
export function AudioRecorderView(_props: AudioRecorderViewProps) {
  const recorder = useRecorder()
  const isRecording = recorder.state === 'recording'

  return (
    <ViewShell>
      <ViewHeader
        title="System Audio Recorder"
        subtitle={isRecording ? 'Recording' : 'Idle'}
      />

      <div className="flex flex-1 flex-col items-center justify-center gap-10 overflow-y-auto px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div
            className={`flex h-32 w-32 items-center justify-center rounded-full border-4 transition-colors ${
              isRecording ? 'border-danger/30 bg-danger/5' : 'border-hairline bg-surface-raised'
            }`}
          >
            <button
              type="button"
              onClick={isRecording ? recorder.stop : recorder.start}
              disabled={!!recorder.renamePrompt}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition-colors disabled:opacity-40 ${
                isRecording ? 'bg-danger hover:bg-danger/90' : 'bg-brand-blue hover:bg-brand-cyan'
              }`}
            >
              {isRecording ? <StopIcon width={26} height={26} /> : <RecordIcon width={30} height={30} />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isRecording && <span className="bg-danger h-2 w-2 animate-pulse rounded-full" />}
            <p className="text-text-primary text-3xl font-semibold tabular-nums">{formatElapsed(recorder.elapsedSeconds)}</p>
          </div>

          <p className="text-text-tertiary flex items-center gap-1.5 text-sm">
            {isRecording ? (
              'Recording system audio…'
            ) : (
              <>
                <ClockIcon width={13} height={13} />
                Captures speaker/headphone output — not your microphone
              </>
            )}
          </p>
        </div>

        <div className="w-full max-w-sm">
          <LiveWaveform levelDbfs={recorder.levelDbfs} active={isRecording} />
        </div>

        {recorder.error && (
          <div className="border-danger/30 bg-danger/10 text-danger max-w-sm rounded-xl border px-4 py-3 text-center text-sm">
            {recorder.error}
          </div>
        )}

        {recorder.renamePrompt && (
          <RenamePrompt
            defaultName={recorder.renamePrompt.defaultName}
            saving={recorder.renaming}
            onConfirm={recorder.confirmRename}
            onSkip={recorder.skipRename}
          />
        )}

        {recorder.notice && (
          <div className="border-hairline bg-surface-raised flex w-full max-w-sm min-w-0 flex-col items-center gap-3 rounded-xl border px-5 py-4 text-center">
            <p className="text-text-primary text-sm font-medium">
              {recorder.notice.reason === 'silence'
                ? 'Recording stopped automatically after 3 minutes of silence.'
                : 'Recording saved.'}
            </p>
            <p className="text-text-tertiary w-full min-w-0 truncate text-xs" title={recorder.notice.path}>
              {recorder.notice.path}
            </p>
            <button
              type="button"
              onClick={recorder.openDownloads}
              className="bg-brand-blue hover:bg-brand-cyan flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white transition-colors"
            >
              <FolderIcon width={13} height={13} />
              Open Downloads folder
            </button>
          </div>
        )}

        <RecentRecordings refreshKey={recorder.notice} />
      </div>
    </ViewShell>
  )
}
