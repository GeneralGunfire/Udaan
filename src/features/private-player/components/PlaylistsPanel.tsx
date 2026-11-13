import { useEffect, useState } from 'react'
import { PlusIcon, TrashIcon, PlayIcon, QueueIcon } from '@/shared/icons'
import { listPlaylists, savePlaylist, deletePlaylist, type StoredPlaylist } from '@/integrations/audio-library/client'
import type { AudioTrack } from '../lib/types'
import { Select } from '@/shared/components/ui/select'
import { Button } from '@/shared/components/ui/button'

interface PlaylistsPanelProps {
  tracks: AudioTrack[]
  onPlayQueue: (tracks: AudioTrack[], startIndex: number) => void
}

/** User-created playlists — the backend (audio_library_list_playlists /
 * _save_playlist / _delete_playlist, SQLite-backed) already existed but
 * had no frontend consumer; this is that consumer. Deliberately simple:
 * create a named playlist from the currently browsed library, add/remove
 * tracks isn't wired yet beyond creation — matches the original app's own
 * playlist feature set (create/rename/delete/add-remove), built out
 * incrementally rather than all at once. */
export function PlaylistsPanel({ tracks, onPlayQueue }: PlaylistsPanelProps) {
  const [playlists, setPlaylists] = useState<StoredPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    listPlaylists()
      .then(setPlaylists)
      .catch((err) => console.error('Failed to load playlists:', err))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const playlist: StoredPlaylist = { id: `pl_${Date.now()}`, name, trackPaths: [], createdAt: Date.now() }
    try {
      await savePlaylist(playlist)
      setPlaylists((prev) => [...prev, playlist])
      setNewName('')
      setCreating(false)
      setSelectedId(playlist.id)
    } catch (err) {
      console.error('Failed to create playlist:', err)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePlaylist(id)
      setPlaylists((prev) => prev.filter((p) => p.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      console.error('Failed to delete playlist:', err)
    }
  }

  async function handleAddTrack(playlistId: string, trackPath: string) {
    const playlist = playlists.find((p) => p.id === playlistId)
    if (!playlist || playlist.trackPaths.includes(trackPath)) return
    const updated = { ...playlist, trackPaths: [...playlist.trackPaths, trackPath] }
    try {
      await savePlaylist(updated)
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)))
    } catch (err) {
      console.error('Failed to update playlist:', err)
    }
  }

  async function handleRemoveTrack(playlistId: string, trackPath: string) {
    const playlist = playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    const updated = { ...playlist, trackPaths: playlist.trackPaths.filter((p) => p !== trackPath) }
    try {
      await savePlaylist(updated)
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)))
    } catch (err) {
      console.error('Failed to update playlist:', err)
    }
  }

  const selected = playlists.find((p) => p.id === selectedId) ?? null
  const selectedTracks = selected ? selected.trackPaths.map((path) => tracks.find((t) => t.path === path)).filter((t): t is AudioTrack => !!t) : []

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-text-tertiary text-sm">Loading playlists…</span>
      </div>
    )
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <button type="button" onClick={() => setSelectedId(null)} className="text-text-secondary hover:text-text-primary text-xs">
            ← Playlists
          </button>
        </div>
        <div className="px-6 pb-3">
          <h2 className="text-text-primary text-[17px] font-semibold tracking-tight">{selected.name}</h2>
          <p className="text-text-tertiary text-sm">{selectedTracks.length} tracks</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {selectedTracks.length === 0 ? (
            <p className="text-text-tertiary px-3 py-6 text-center text-sm">
              No tracks yet — browse the library and use "Add to playlist" on any track.
            </p>
          ) : (
            selectedTracks.map((track, idx) => (
              <div key={track.path} className="group hover:bg-[var(--os-menu-item-hover)] flex items-center gap-3 rounded-lg px-3 py-2.5">
                <button type="button" onClick={() => onPlayQueue(selectedTracks, idx)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary truncate text-[13px] font-medium">{track.title}</p>
                    <p className="text-text-tertiary truncate text-[13px]">{track.artist}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveTrack(selected.id, track.path)}
                  className="text-text-tertiary hover:text-danger shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <TrashIcon width={14} height={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <h2 className="text-text-primary text-[17px] font-semibold tracking-tight">Playlists</h2>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="text-text-secondary hover:text-text-primary border-hairline rounded-lg border p-2 transition-colors"
        >
          <PlusIcon width={16} height={16} />
        </button>
      </div>

      {creating && (
        <div className="flex gap-2 px-6 pb-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Playlist name…"
            className="border-hairline text-text-primary placeholder:text-text-tertiary flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
          />
          <button type="button" onClick={handleCreate} className="bg-accent hover:brightness-110 rounded-lg px-4 text-sm font-medium text-white transition-colors">
            Create
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {playlists.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <QueueIcon width={32} height={32} className="text-text-tertiary" />
            <p className="text-text-secondary text-sm">No playlists yet</p>
          </div>
        ) : (
          playlists.map((playlist) => (
            <div key={playlist.id} className="group hover:bg-[var(--os-menu-item-hover)] flex items-center gap-3 rounded-lg px-3 py-2">
              <button type="button" onClick={() => setSelectedId(playlist.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <div className="bg-[var(--surface-raised)] flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                  <PlayIcon width={16} height={16} className="text-text-secondary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary truncate text-sm font-medium">{playlist.name}</p>
                  <p className="text-text-tertiary truncate text-xs">{playlist.trackPaths.length} tracks</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(playlist.id)}
                className="text-text-tertiary hover:text-danger shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <TrashIcon width={14} height={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Quick add-to-playlist affordance, minimal for this pass: pick any
          track from the currently loaded library and file it into a
          playlist without leaving this page. */}
      {playlists.length > 0 && tracks.length > 0 && (
        <QuickAddRow playlists={playlists} tracks={tracks} onAdd={handleAddTrack} />
      )}
    </div>
  )
}

function QuickAddRow({
  playlists,
  tracks,
  onAdd,
}: {
  playlists: StoredPlaylist[]
  tracks: AudioTrack[]
  onAdd: (playlistId: string, trackPath: string) => void
}) {
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id ?? '')
  const [trackPath, setTrackPath] = useState(tracks[0]?.path ?? '')

  return (
    <div className="border-hairline flex items-center gap-2 border-t p-2">
      {/* Themed Selects, not native ones. A native <select> draws the
          OS's own popup, which ignores this app's palette entirely — the
          `bg-[#111]` these options used to carry was a hand-patch for
          exactly that, and it only ever fixed the list, never the
          trigger. See ui/select.tsx. */}
      <Select
        value={playlistId}
        onChange={setPlaylistId}
        size="sm"
        className="min-w-0 flex-1"
        options={playlists.map((p) => ({ value: p.id, label: p.name }))}
      />
      <Select
        value={trackPath}
        onChange={setTrackPath}
        size="sm"
        className="min-w-0 flex-[2]"
        options={tracks.slice(0, 200).map((t) => ({ value: t.path, label: t.title }))}
      />
      <Button
        type="button"
        variant="brand"
        size="pill-sm"
        onClick={() => playlistId && trackPath && onAdd(playlistId, trackPath)}
      >
        Add
      </Button>
    </div>
  )
}
