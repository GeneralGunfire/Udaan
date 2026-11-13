/**
 * Runs at most `limit` async jobs at once, queuing the rest — used so
 * mounting many grid tiles at once (e.g. switching to Grid view in a
 * folder full of images) fans its thumbnail loads out over time instead
 * of firing one IPC call per visible file simultaneously. That fan-out is
 * exactly what previously froze the app: dozens of uncapped, synchronous
 * `file_explorer_read_file` invokes queued on the IPC thread at once.
 */
export function createConcurrencyLimiter(limit: number) {
  let active = 0
  const queue: (() => void)[] = []

  function next() {
    if (active >= limit || queue.length === 0) return
    active += 1
    const job = queue.shift()!
    job()
  }

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            next()
          })
      })
      next()
    })
  }
}

/** Shared across all grid tiles in File Explorer — a per-component limiter would still let every mounted component's own limiter run N-at-once in parallel. */
export const thumbnailLimiter = createConcurrencyLimiter(4)
