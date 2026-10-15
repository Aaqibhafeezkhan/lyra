import { create } from 'zustand'
import type { LyricsResult, Track } from '@shared/types'
import { usePlayer } from './player'

type LyricsState = { phase: 'idle' } | { phase: 'loading'; trackId: string } | { phase: 'ready'; result: LyricsResult }

interface LyricsStore {
  state: LyricsState
  init(): void
  retry(): void
}

let requestSeq = 0

async function load(track: Track, force: boolean, set: (s: LyricsState) => void): Promise<void> {
  const seq = ++requestSeq
  set({ phase: 'loading', trackId: track.id })
  try {
    const result = await (force ? window.lyra.lyrics.refresh(track) : window.lyra.lyrics.get(track))
    if (seq === requestSeq) set({ phase: 'ready', result })
  } catch (e) {
    if (seq !== requestSeq) return
    set({
      phase: 'ready',
      result: {
        trackId: track.id,
        status: 'error',
        provider: 'unknown',
        lines: [],
        error: { kind: 'unknown', message: (e as Error).message, retryable: true }
      }
    })
  }
}

export const useLyrics = create<LyricsStore>((set) => ({
  state: { phase: 'idle' },

  init() {
    const setState = (state: LyricsState): void => set({ state })
    let current: string | null = null
    const check = (): void => {
      const track = usePlayer.getState().snapshot?.track ?? null
      if (track?.id === current) return
      current = track?.id ?? null
      requestSeq++
      if (!track) return setState({ phase: 'idle' })
      void load(track, false, setState)
    }
    usePlayer.subscribe(check)
    check()
  },

  retry() {
    const track = usePlayer.getState().snapshot?.track
    if (track) void load(track, true, (state) => set({ state }))
  }
}))
