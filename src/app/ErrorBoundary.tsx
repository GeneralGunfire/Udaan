import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level safety net. Without this, an uncaught exception thrown during
 * render ANYWHERE in the tree unmounts the entire app — React's default
 * behavior — which is exactly what "the screen goes blank" was: the
 * WebView2 process itself stayed alive (confirmed via Task Manager while
 * chasing the DJ-board report), only the rendered React tree disappeared,
 * meaning something was throwing during render rather than the renderer
 * process crashing. That's consistent with a live AudioParam call (a
 * knob's onChange chain ultimately calls `AudioParam.setTargetAtTime`,
 * which throws a real DOMException/TypeError on a non-finite or
 * out-of-range value) or any other render-time exception. This boundary
 * turns that from "the whole app silently vanishes with zero diagnostic
 * info" into a visible error screen with the actual message/stack, and a
 * way back to a working app without restarting Udaan entirely — the
 * blank-screen symptom becomes something a user can act on and something
 * this can now actually be root-caused from and fixed for good, since the
 * next occurrence will show its real cause here instead of nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Udaan: uncaught render error — this is what used to blank the whole app silently:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        className="fixed inset-0 z-[999] flex flex-col items-center justify-center gap-4 p-8 text-center"
        style={{ backgroundColor: 'var(--surface-base)' }}
      >
        <p className="text-sm font-semibold tracking-[0.08em] text-danger uppercase">Something went wrong</p>
        <p className="max-w-lg text-sm text-white/70">{error.message}</p>
        {error.stack && (
          <pre className="max-h-40 max-w-2xl overflow-auto rounded-lg bg-white/5 p-3 text-left text-2xs text-white/40">
            {error.stack}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-2 rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
        >
          Try to recover
        </button>
      </div>
    )
  }
}
