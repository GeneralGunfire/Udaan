/**
 * Lyrics files. A ".lrc" file marks each line with when it is sung, "[01:23.45] the words", so the player can
 * follow along; a plain text file is just the words. A line may carry several times (a repeated chorus), and
 * a file may say "[offset:+500]" to shift everything (milliseconds, positive = sooner).
 */
export interface LyricLine {
  /** Seconds from the start, or null in a plain, unsynced lyric. */
  t: number | null
  text: string
}

export interface ParsedLyrics {
  lines: LyricLine[]
  synced: boolean
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export function parseLyrics(raw: string): ParsedLyrics {
  const src = raw.replace(/\r\n?/g, '\n')
  let offset = 0
  const timed: LyricLine[] = []
  const plain: LyricLine[] = []
  for (const line of src.split('\n')) {
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(line.trim())
    if (off) {
      offset = Number(off[1]) / 1000
      continue
    }
    // Tags like [ar:Artist] or [ti:Title] are information, not lyrics.
    if (/^\[[a-z]{2,}:[^\]]*\]\s*$/i.test(line.trim())) continue
    const stamps = [...line.matchAll(STAMP)]
    const text = line.replace(STAMP, '').trim()
    if (stamps.length) {
      for (const m of stamps) {
        const frac = m[3] ? Number(`0.${m[3]}`) : 0
        timed.push({ t: Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac - offset), text })
      }
    } else plain.push({ t: null, text: line.trimEnd() })
  }
  // A file with a few stray stamps among real text is not synced; it needs a real run of timed lines.
  if (timed.length >= 3 && timed.length >= plain.filter((l) => l.text).length) {
    return { lines: timed.sort((a, b) => a.t! - b.t!), synced: true }
  }
  return { lines: src.split('\n').map((l) => ({ t: null, text: l.replace(STAMP, '').trimEnd() })), synced: false }
}

/** The line being sung at `time`: the last one that has started. -1 before the first line. */
export function activeLine(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((lines[mid].t ?? Infinity) <= time) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
