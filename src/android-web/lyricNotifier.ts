import { useLyrics } from '@/store/lyrics'
import { useOffsets } from '@/store/offsets'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { rpc } from './rpc'

/**
 * Sends the synced lines of the current song to the phone once, so the lyrics notification (shade + lock screen)
 * can follow the song by itself, even after Lyra's screen is closed.
 */
let last = ''

function push(): void {
  const track = usePlayer.getState().snapshot?.track
  if (!track) return
  const st = useLyrics.getState().state
  const lines = st.phase === 'ready' && st.result.trackId === track.id && st.result.status === 'synced' ? st.result.lines : []
  const offset = useSettings.getState().settings.lyricOffsetMs + (useOffsets.getState().map[track.id] ?? 0)
  const state = st.phase === 'ready' && st.result.trackId === track.id ? (st.result.status === 'synced' ? 'synced' : 'none') : 'loading'
  const sig = `${track.id}|${lines.length}|${offset}|${state}`
  if (sig === last) return
  last = sig
  void rpc('setLyrics', track.id, JSON.stringify(lines.map((l) => [l.timeMs, l.text])), offset, state).catch(() => {
    last = '' // try again on the next change
  })
}

export function startLyricNotifier(): void {
  useLyrics.subscribe(push)
  usePlayer.subscribe(push)
  useOffsets.subscribe(push)
  useSettings.subscribe(push)
  push()
}
