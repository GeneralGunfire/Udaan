/* Plays a live stereo stream (captured from another app by the Rust tap)
 * into the Web Audio graph.
 *
 * Why it is written this way:
 *  - PCM arrives in ~10 ms bursts over IPC with some jitter, so playback
 *    reads from a ring buffer that is kept `target` frames full. Too empty
 *    and every IPC hiccup is an audible dropout; too full and the DJ board
 *    feels laggy. The default is 50 ms; "stable" mode uses more.
 *  - The capture clock and the output clock never agree exactly. Instead of
 *    occasionally dropping or repeating a block (clicks), the read rate is
 *    nudged by at most ±0.2% toward the target fill. Reads use 4-point cubic
 *    (Hermite) interpolation: linear interpolation at a non-integer rate
 *    dulls the highs and adds a faint grit, which is exactly what hurts
 *    clarity. A dropout makes the buffer grow a little (up to 250 ms), so a
 *    busy machine settles on a stable delay instead of crackling forever.
 *  - The source app is turned down at Windows, and `gain` restores it, so the
 *    output is hard-clamped: if anything ever changed the source volume
 *    behind our back, the worst case is clipping, never a blast.
 *  - Loop (beat repeat) replays the audio just heard. The wrap is
 *    crossfaded into the samples that naturally follow the loop end, so the
 *    seam is continuous rather than a click.
 */
class LiveCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.cap = 1 << 18
    this.mask = this.cap - 1
    this.L = new Float32Array(this.cap)
    this.R = new Float32Array(this.cap)
    this.w = 0 // frames written, monotonic
    this.r = 0 // read position in frames (fractional)
    this.gain = 1
    this.baseTarget = Math.round(sampleRate * 0.07)
    this.target = this.baseTarget
    this.maxTarget = Math.round(sampleRate * 0.25)
    this.primed = false
    this.loop = null // { S, m, X, p }
    this.fadeIn = 0
    this.underruns = 0
    this.calm = 0
    this.sinceReport = 0
    this.port.onmessage = (e) => {
      const d = e.data
      if (d.type === 'pcm') {
        const f = new Float32Array(d.buf)
        const n = f.length >> 1
        const mask = this.mask
        let w = this.w
        for (let i = 0; i < n; i++, w++) {
          this.L[w & mask] = f[2 * i]
          this.R[w & mask] = f[2 * i + 1]
        }
        this.w = w
      } else if (d.type === 'gain') {
        this.gain = d.gain
      } else if (d.type === 'target') {
        this.baseTarget = Math.round(sampleRate * d.ms / 1000)
        this.target = this.baseTarget
      } else if (d.type === 'loop') {
        const m = Math.max(256, Math.min(Math.round(d.frames), Math.floor(this.cap / 4)))
        const X = Math.min(480, m >> 2)
        this.loop = { S: Math.floor(this.r) - m - X, m, X, p: 0 }
      } else if (d.type === 'loop-off') {
        if (this.loop) {
          this.loop = null
          // The live stream kept arriving while we looped: rejoin it at the
          // normal latency instead of playing stale audio.
          this.r = this.w - this.target
          this.fadeIn = 480
        }
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    const oL = out[0]
    const oR = out[1] || out[0]
    const n = oL.length
    const mask = this.mask
    const g = this.gain

    if (!this.primed && !this.loop) {
      if (this.w - this.r >= this.target || this.w >= this.target * 2) {
        this.r = this.w - this.target
        this.primed = true
        this.fadeIn = 480
      } else {
        oL.fill(0)
        oR.fill(0)
        this.report(n)
        return true
      }
    }

    let i = 0
    if (this.loop) {
      const lp = this.loop
      for (; i < n; i++) {
        const a = lp.S + lp.p
        let l = this.L[a & mask]
        let r = this.R[a & mask]
        if (lp.p < lp.X) {
          const w = lp.p / lp.X
          const b = lp.S + lp.m + lp.p
          l = l * w + this.L[b & mask] * (1 - w)
          r = r * w + this.R[b & mask] * (1 - w)
        }
        oL[i] = Math.max(-1, Math.min(1, l * g))
        oR[i] = Math.max(-1, Math.min(1, r * g))
        if (++lp.p >= lp.m) lp.p = 0
      }
    } else {
      const fill = this.w - this.r
      if (fill > this.target * 4) this.r = this.w - this.target
      const err = this.w - this.r - this.target
      const rate = 1 + Math.max(-0.002, Math.min(0.002, err * 5e-7))
      for (; i < n; i++) {
        const i0 = Math.floor(this.r)
        if (i0 + 2 >= this.w) {
          // Ran dry: go silent and refill, and ask for a little more cushion.
          this.primed = false
          this.underruns++
          this.target = Math.min(this.maxTarget, this.target + Math.round(sampleRate * 0.01))
          this.calm = 0
          break
        }
        const f = this.r - i0
        const m1 = (i0 - 1) & mask
        const a = i0 & mask
        const b = (i0 + 1) & mask
        const c = (i0 + 2) & mask
        const cubic = (y0, y1, y2, y3) => {
          // Catmull-Rom spline through y1..y2.
          const c1 = 0.5 * (y2 - y0)
          const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
          const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
          return ((c3 * f + c2) * f + c1) * f + y1
        }
        let l = cubic(this.L[m1], this.L[a], this.L[b], this.L[c]) * g
        let r = cubic(this.R[m1], this.R[a], this.R[b], this.R[c]) * g
        if (this.fadeIn > 0) {
          const k = 1 - this.fadeIn / 480
          l *= k
          r *= k
          this.fadeIn--
        }
        oL[i] = Math.max(-1, Math.min(1, l))
        oR[i] = Math.max(-1, Math.min(1, r))
        this.r += rate
      }
    }
    for (; i < n; i++) {
      oL[i] = 0
      oR[i] = 0
    }
    this.report(n)
    return true
  }

  report(n) {
    this.sinceReport += n
    if (this.sinceReport >= sampleRate / 2) {
      this.sinceReport = 0
      // Quiet for ~4 s: let the safety buffer shrink back toward its base so the delay does not stay inflated.
      if (++this.calm >= 8 && this.target > this.baseTarget) this.target = Math.max(this.baseTarget, this.target - Math.round(sampleRate * 0.005))
      this.port.postMessage({
        type: 'stats',
        fillMs: Math.max(0, ((this.w - this.r) / sampleRate) * 1000),
        targetMs: (this.target / sampleRate) * 1000,
        underruns: this.underruns,
        looping: !!this.loop,
      })
    }
  }
}

registerProcessor('live-capture', LiveCapture)
