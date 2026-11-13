// Dev-only stand-in for Tauri's native side, so the real panels run in a plain browser.
;(() => {
  const callbacks = new Map()
  const listeners = {}
  let next = 1
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const state = {
    apo: true,
    preset: null,
    volume: { level: 0.62, muted: false },
  }
  const log = (text) => window.dispatchEvent(new CustomEvent('preview-log', { detail: text }))
  window.__preview = { state, log }

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'preview' }, currentWebview: { windowLabel: 'preview', label: 'preview' } },
    transformCallback(cb) {
      const id = next++
      callbacks.set(id, cb)
      return id
    },
    unregisterCallback(id) {
      callbacks.delete(id)
    },
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      switch (cmd) {
        case 'plugin:event|listen': {
          const eventId = next++
          ;(listeners[args.event] ||= []).push({ eventId, handler: args.handler })
          return eventId
        }
        case 'plugin:event|unlisten':
          listeners[args.event] = (listeners[args.event] || []).filter((l) => l.eventId !== args.eventId)
          return null
        case 'plugin:event|emit':
          for (const l of listeners[args.event] || []) callbacks.get(l.handler)?.({ event: args.event, id: next++, payload: args.payload })
          return null

        case 'taskbar_prefs_get':
          return localStorage.getItem('preview-pref:' + args.key)
        case 'taskbar_prefs_set':
          localStorage.setItem('preview-pref:' + args.key, args.value)
          return null

        case 'shell_volume':
          return { ...state.volume }
        case 'shell_set_volume':
          if (args.level != null) state.volume.level = args.level
          if (args.muted != null) state.volume.muted = args.muted
          window.dispatchEvent(new CustomEvent('preview-volume', { detail: { ...state.volume } }))
          log(`Volume ${Math.round(state.volume.level * 100)}%${state.volume.muted ? ' (muted)' : ''}`)
          return { ...state.volume }

        case 'sound_fx_status':
          return { installed: state.apo, path: state.apo ? 'C:\\Program Files\\EqualizerAPO\\config' : null, preset: state.apo ? state.preset : null }
        case 'sound_fx_apply':
          if (!state.apo) throw 'not-installed'
          state.preset = args.preset
          window.dispatchEvent(new CustomEvent('preview-eq', { detail: { preset: args.preset, strength: args.strength } }))
          log(`Equalizer APO set to ${args.preset} at ${Math.round(args.strength * 100)}%`)
          return null
        case 'sound_fx_apply_custom':
          if (!state.apo) throw 'not-installed'
          state.preset = 'custom'
          window.dispatchEvent(new CustomEvent('preview-eq', { detail: { preset: 'custom', custom: { bass: args.bass, voice: args.voice, treble: args.treble } } }))
          log(`Equalizer APO set to custom: bass ${args.bass} dB, voice ${args.voice} dB, treble ${args.treble} dB`)
          return null
        case 'sound_fx_download_installer':
          await sleep(1500)
          log('Installer downloaded and opened (pretend)')
          return 'C:\\Users\\You\\Downloads\\EqualizerAPO-x64-1.4.2.exe'
        case 'speaker_keepalive_set':
          log(`Keep speakers awake ${args.enabled ? 'on' : 'off'}, strength ${args.level}`)
          return null
        case 'edge_light_set_enabled':
          log(`Edge light ${args.enabled ? 'on' : 'off'}`)
          return null
        case 'installed_apps_launch':
          log(`Would open: ${args.path ?? JSON.stringify(args)}`)
          return null
        default:
          return null
      }
    },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
})()
