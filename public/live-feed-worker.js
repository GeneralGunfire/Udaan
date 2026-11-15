/* Reads the live audio stream from Rust (a loopback HTTP stream of raw stereo float PCM) and hands it to
 * the audio worklet over a private MessageChannel. It runs on its own thread, so nothing the page is
 * doing (React renders, canvas frames) can delay the audio. Frames are 8 bytes (two float32), and a TCP
 * read can end anywhere, so leftover bytes are carried into the next chunk. */
let controller = null

onmessage = async (e) => {
  const d = e.data
  if (d.type === 'stop') {
    if (controller) controller.abort()
    close()
    return
  }
  if (d.type !== 'start') return
  const port = d.port
  controller = new AbortController()
  let carry = new Uint8Array(0)
  try {
    const res = await fetch(d.url, { signal: controller.signal, cache: 'no-store' })
    const reader = res.body.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      let chunk = value
      if (carry.length) {
        const m = new Uint8Array(carry.length + chunk.length)
        m.set(carry)
        m.set(chunk, carry.length)
        chunk = m
        carry = new Uint8Array(0)
      }
      const usable = chunk.length - (chunk.length % 8)
      if (usable < chunk.length) carry = chunk.slice(usable)
      if (usable > 0) {
        const buf = chunk.slice(0, usable).buffer
        port.postMessage({ type: 'pcm', buf }, [buf])
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) postMessage({ type: 'error', message: String(err) })
  }
  postMessage({ type: 'ended' })
}
