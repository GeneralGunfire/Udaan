// Runs in every frame of the browser preview, before the app. It is the frame's half of a pretend Tauri:
// invokes go to the host page (web-os/host.ts), which plays the part of Rust and of the window manager.
;(() => {
  const q = new URLSearchParams(location.search)
  const label = q.get('label') || 'main'
  const SW = Number(q.get('sw')) || 1920
  const SH = Number(q.get('sh')) || 1080

  // One pixel is one pixel here; the screen is the host's screen, not the real monitor.
  try {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true })
  } catch {}
  try {
    const fake = { width: SW, height: SH, availWidth: SW, availHeight: SH - 34, availLeft: 0, availTop: 0, colorDepth: 24, pixelDepth: 24 }
    Object.defineProperty(window, 'screen', { get: () => fake, configurable: true })
  } catch {}

  const callbacks = new Map()
  const listeners = {}
  const pending = new Map()
  let next = 1

  const deliver = (event, payload) => {
    for (const l of listeners[event] || []) callbacks.get(l.handler)?.({ event, id: next++, payload })
  }

  const toHost = (msg) => window.parent.postMessage({ __udaan: true, label, ...msg }, '*')

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
    transformCallback(cb) {
      const id = next++
      callbacks.set(id, cb)
      return id
    },
    unregisterCallback(id) {
      callbacks.delete(id)
    },
    convertFileSrc: (p) => p,
    invoke(cmd, args = {}) {
      if (cmd === 'plugin:event|listen') {
        const eventId = next++
        ;(listeners[args.event] ||= []).push({ eventId, handler: args.handler })
        return Promise.resolve(eventId)
      }
      if (cmd === 'plugin:event|unlisten') {
        listeners[args.event] = (listeners[args.event] || []).filter((l) => l.eventId !== args.eventId)
        return Promise.resolve(null)
      }
      return new Promise((resolve, reject) => {
        const id = next++
        pending.set(id, { resolve, reject })
        toHost({ type: 'invoke', id, cmd, args })
      })
    },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }

  // Where this window is on the screen, as the real OS reports it (window.screenX / screenY): the host tells us.
  let gx = 0
  let gy = 0
  try {
    Object.defineProperty(window, 'screenX', { get: () => gx, configurable: true })
    Object.defineProperty(window, 'screenY', { get: () => gy, configurable: true })
  } catch {}

  window.addEventListener('message', (e) => {
    const m = e.data
    if (!m || !m.__udaan) return
    if (m.type === 'result') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.value)
      else p.reject(m.error)
    } else if (m.type === 'geometry') {
      gx = m.x
      gy = m.y
    } else if (m.type === 'event') {
      if (m.to && m.to !== label) return
      deliver(m.event, m.payload)
    }
  })

  toHost({ type: 'hello' })

  // Focus, as the window itself sees it.
  window.addEventListener('focus', () => deliver('tauri://focus', true))
  window.addEventListener('blur', () => deliver('tauri://blur', false))

  // What the host needs to know about the pointer: clicks (focus, "click outside closes a popup") and
  // movement near the bottom edge (dock auto-hide).
  let lastMove = 0
  window.addEventListener(
    'pointerdown',
    (e) => toHost({ type: 'ptr', kind: 'down', x: e.clientX, y: e.clientY }),
    true,
  )
  window.addEventListener(
    'pointermove',
    (e) => {
      const now = performance.now()
      if (now - lastMove < 50) return
      lastMove = now
      toHost({ type: 'ptr', kind: 'move', x: e.clientX, y: e.clientY })
    },
    true,
  )
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1' || e.key === 'F3') {
      e.preventDefault()
      toHost({ type: 'key', key: e.key })
    }
  })

  // Dragging a window by its title bar (what data-tauri-drag-region does in the real shell).
  let drag = null
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const t = e.target
      if (!(t instanceof Element) || !t.closest('[data-tauri-drag-region]') || t.closest('button,a,input,textarea,select,[data-no-drag]')) return
      if (e.detail === 2) {
        toHost({ type: 'invoke', id: next++, cmd: 'plugin:window|toggle_maximize', args: {} })
        return
      }
      drag = { sx: e.screenX, sy: e.screenY }
      toHost({ type: 'drag', phase: 'start' })
    },
    true,
  )
  window.addEventListener(
    'pointermove',
    (e) => {
      if (drag) toHost({ type: 'drag', phase: 'move', dx: e.screenX - drag.sx, dy: e.screenY - drag.sy })
    },
    true,
  )
  const endDrag = () => {
    if (!drag) return
    drag = null
    toHost({ type: 'drag', phase: 'end' })
  }
  window.addEventListener('pointerup', endDrag, true)
  window.addEventListener('blur', endDrag)
})()
