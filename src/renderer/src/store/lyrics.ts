import { create } from 'zustand'
import type { LyricsResult, Track } from '@shared/types'
import { usePlayer } from './player'

type LyricsState = { phase: 'idle' } | { phase: 'loading'; trackId: string } | { phase: 'ready'; result: LyricsResult }

interface LyricsStore {
  state: LyricsState
  init(): void
  retry(): void
  /** Replace the current result (e.g. after the user picks another match). */
  apply(result: LyricsResult): void
}

let requestSeq = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let autoRetries = 0
const MAX_AUTO_RETRIES = 3

/** Temporary failures (rate limit, offline) heal themselves: retry a few times with growing delay. */
function scheduleRetry(track: Track, failed: boolean, set: (s: LyricsState) => void): void {
  clearTimeout(retryTimer)
  if (!failed) {
    autoRetries = 0
    return
  }
  if (autoRetries >= MAX_AUTO_RETRIES) return
  autoRetries++
  retryTimer = setTimeout(() => {
    if (usePlayer.getState().snapshot?.track?.id === track.id) void load(track, true, set)
  }, 20_000 * autoRetries)
}

async function load(track: Track, force: boolean, set: (s: LyricsState) => void): Promise<void> {
  const seq = ++requestSeq
  set({ phase: 'loading', trackId: track.id })
  try {
    const result = await (force ? window.lyra.lyrics.refresh(track) : window.lyra.lyrics.get(track))
    if (seq === requestSeq) {
      set({ phase: 'ready', result })
      scheduleRetry(track, result.status === 'error' && result.error?.retryable !== false, set)
    }
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
      autoRetries = 0
      clearTimeout(retryTimer)
      if (!track) return setState({ phase: 'idle' })
      void load(track, false, setState)
    }
    usePlayer.subscribe(check)
    check()
  },

  apply(result) {
    requestSeq++ // drop any in-flight automatic lookup
    set({ state: { phase: 'ready', result } })
  },

  retry() {
    const track = usePlayer.getState().snapshot?.track
    if (track) void load(track, true, (state) => set({ state }))
  }
}))
