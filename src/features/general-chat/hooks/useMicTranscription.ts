import { useCallback, useRef, useState } from 'react'
import { transcribeBytes } from '@/integrations/local-model'

/**
 * Records mic audio in the browser (no native audio plugin needed — the
 * Tauri webview supports `getUserMedia`/`MediaRecorder` directly), then
 * hands the raw bytes to the Rust-side whisper transcription command.
 */
export function useMicTranscription() {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    chunksRef.current = []

    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorderRef.current = recorder
    recorder.start()
    setRecording(true)
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

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        chunksRef.current = []
        setTranscribing(true)
        try {
          const buffer = await blob.arrayBuffer()
          const result = await transcribeBytes(new Uint8Array(buffer))
          resolve(result.text)
        } catch (err) {
          console.error('Transcription failed:', err)
          resolve(null)
        } finally {
          setTranscribing(false)
        }
      }
      recorder.stop()
    })
  }, [])

  return { recording, transcribing, start, stop }
}
