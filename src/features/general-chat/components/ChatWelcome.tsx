/**
 * Empty-conversation landing screen — plain and quiet. The previous
 * version scaled the app's wordmark 1.5x as a hero moment with staggered
 * entrance animation; that read as ceremonial for what's just an empty
 * state, one of the concrete things called out as making this page feel
 * "too big." A single line of text does the same job.
 */
export function ChatWelcome() {
  return (
    <div className="mb-6 flex shrink-0 flex-col items-center gap-1.5 px-1 text-center">
      <h1 className="text-text-primary text-xl font-semibold tracking-tight">
        What are we working on?
      </h1>
      <p className="text-text-tertiary text-sm">
        Ask anything, or pick up where you left off.
      </p>
    </div>
  )
}
