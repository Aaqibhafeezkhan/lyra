import { useEffect, useState } from 'react'
import { usePlayer } from '@/store/player'
import { useLyrics } from '@/store/lyrics'
import { useActiveLine } from './useLyricsSync'

export type PlayerView = 'loading' | 'connect' | 'offline' | 'idle' | 'ad' | 'playing'

/** Collapses connection + playback state into the single screen the UI should show. */
export function usePlayerView(): PlayerView {
  const status = usePlayer((s) => s.status)
  const snap = usePlayer((s) => s.snapshot)
  const [grace, setGrace] = useState(true)
  // avoid flashing "nothing playing" before the very first snapshot arrives
  useEffect(() => {
    const t = setTimeout(() => setGrace(false), 900)
    return () => clearTimeout(t)
  }, [])

  if (!status) return 'loading'
  if (status.state === 'needs-setup' || status.state === 'disconnected' || status.state === 'connecting') return 'connect'
  if (snap?.track) return 'playing'
  if (status.state === 'offline') return 'offline'
  if (snap?.isAdOrUnknown) return 'ad'
  if (!snap && grace) return 'loading'
  return 'idle'
}

export interface LyricPreview {
  kind: 'line' | 'loading' | 'instrumental' | 'plain' | 'none' | 'error' | 'gap'
  text: string
  synced: boolean
}

/** Short description of the "current lyric" for compact surfaces. */
export function useLyricPreview(): LyricPreview {
  const state = useLyrics((s) => s.state)
  const lines = state.phase === 'ready' && state.result.status === 'synced' ? state.result.lines : []
  const idx = useActiveLine(lines, lines.length > 0)

  if (state.phase !== 'ready') return { kind: 'loading', text: '', synced: false }
  const r = state.result
  switch (r.status) {
    case 'synced': {
      const line = lines[idx]
      if (!line) return { kind: 'gap', text: '', synced: true }
      return line.text ? { kind: 'line', text: line.text, synced: true } : { kind: 'gap', text: '', synced: true }
    }
    case 'plain':
      return { kind: 'plain', text: 'Lyrics available · not synced', synced: false }
    case 'instrumental':
      return { kind: 'instrumental', text: 'Instrumental', synced: false }
    case 'error':
      return { kind: 'error', text: 'Lyrics unavailable right now', synced: false }
    default:
      return { kind: 'none', text: 'No lyrics found', synced: false }
  }
}
