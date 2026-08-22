import { useCallback, useRef, useState } from 'react'
import { transcribeBytes } from '@/integrations/local-model'

/**
 * Records mic audio in the browser (no native audio plugin needed — the
 * Tauri webview supports `getUserMedia`/`MediaRecorder` directly), then
 * hands the raw bytes to the Rust-side whisper transcription command.
 * Every failure mode surfaces a real `error` string instead of silently
 * resolving to null — a mic click should never look like it "did nothing."
 */
export function useMicTranscription() {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onerror = (e) => {
        const message = (e as unknown as { error?: Error }).error?.message ?? 'Recording failed'
        setError(`Microphone recording error: ${message}`)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow microphone access for Udaan and try again.'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No microphone found.'
            : `Could not start recording: ${err instanceof Error ? err.message : String(err)}`
      setError(message)
      throw err
    }
  }, [])

  const stop = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current
      if (!recorder) {
        resolve(null)
        return
      }

      recorder.onstop = async () => {
        setRecording(false)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null

        if (chunksRef.current.length === 0) {
          setError('No audio was captured — try holding the mic button a little longer.')
          resolve(null)
          return
        }

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        chunksRef.current = []
        setTranscribing(true)
        try {
          const buffer = await blob.arrayBuffer()
          const result = await transcribeBytes(new Uint8Array(buffer))
          if (!result.text.trim()) {
            setError('No speech detected in that recording — try again, speaking clearly.')
            resolve(null)
            return
          }
          resolve(result.text)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setError(`Transcription failed: ${message}`)
          resolve(null)
        } finally {
          setTranscribing(false)
        }
      }
      recorder.stop()
    })
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { recording, transcribing, error, start, stop, clearError }
}
