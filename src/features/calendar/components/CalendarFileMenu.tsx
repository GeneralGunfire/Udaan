import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { createEvent, listEvents } from '@/integrations/schedule/client'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button } from '@/shared/components/ui/button'
import { parseIcs, toIcs } from '../lib/recurrence'

/** Sent after anything outside the hook changed the calendar, so the open Calendar reloads. */
export const CALENDAR_CHANGED = 'udaan:calendar-changed'

/**
 * Calendar files. Export writes every event (repeats and reminders included) as a standard .ics file that Google,
 * Outlook and Apple calendars all open. Import reads one, skips events already here, and adds the rest.
 */
export function CalendarFileMenu() {
  const openMenu = useShellMenu()
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const say = (text: string, bad?: boolean) => {
    setMessage({ text, bad })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 6000)
  }

  const doExport = async () => {
    try {
      const events = await listEvents()
      const path = await saveDialog({ defaultPath: 'Udaan calendar.ics', filters: [{ name: 'Calendar', extensions: ['ics'] }] })
      if (!path) return
      const dated = events.filter((e) => e.date)
      await invoke('chat_write_text', { path, text: toIcs(dated) })
      say(`Exported ${dated.length} event${dated.length === 1 ? '' : 's'}`)
    } catch (e) {
      say(`Couldn’t export: ${typeof e === 'string' ? e : e instanceof Error ? e.message : 'unknown error'}`, true)
    }
  }

  const doImport = async () => {
    try {
      const picked = await openDialog({ multiple: false, filters: [{ name: 'Calendar', extensions: ['ics'] }] })
      if (!picked || Array.isArray(picked)) return
      const text = await invoke<string>('schedule_read_file', { path: picked })
      const parsed = parseIcs(text)
      if (!parsed.length) return say('No events were found in that file.', true)
      const have = new Set((await listEvents()).map((e) => `${e.title}|${e.date}|${e.startTime ?? ''}`))
      let added = 0
      for (const p of parsed) {
        if (have.has(`${p.title}|${p.date}|${p.startTime ?? ''}`)) continue
        await createEvent({ title: p.title, date: p.date, startTime: p.startTime, description: p.description, category: 'personal', allDay: p.allDay, durationMinutes: p.durationMinutes, recurrence: p.recurrence, reminderMinutes: p.reminderMinutes })
        added++
      }
      window.dispatchEvent(new Event(CALENDAR_CHANGED))
      say(added ? `Added ${added} event${added === 1 ? '' : 's'}${added < parsed.length ? `, skipped ${parsed.length - added} already here` : ''}` : 'Everything in that file was already here')
    } catch (e) {
      say(`Couldn’t import: ${typeof e === 'string' ? e : e instanceof Error ? e.message : 'unknown error'}`, true)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && <span className={message.bad ? 'text-danger text-[12px]' : 'text-text-secondary text-[12px]'}>{message.text}</span>}
      <Button
        variant="ghost"
        size="pill-sm"
        className="text-[13px] font-medium"
        title="Import or export a calendar file"
        onClick={(e) => openMenu(e, [{ label: 'Import a calendar file (.ics)…', onSelect: () => void doImport() }, { label: 'Export all events (.ics)…', onSelect: () => void doExport() }])}
      >
        Calendar file
      </Button>
    </div>
  )
}
