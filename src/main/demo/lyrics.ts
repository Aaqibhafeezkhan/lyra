import type { LyricLine, LyricsResult } from '@shared/types'
import { DEMO_INSTRUMENTAL, DEMO_LYRICS, DEMO_PLAIN_ONLY, DEMO_TRACKS, DEMO_WORD_SYNCED } from './data'

/** Spread lines evenly across the song, with proportional word timing when requested. */
function schedule(lines: string[], durationMs: number, words: boolean): LyricLine[] {
  const start = 7000
  const end = durationMs - 9000
  const slot = (end - start) / lines.length
  return lines.map((text, i) => {
    const timeMs = Math.round(start + slot * i)
    if (!words || !text) return { timeMs, text }
    const parts = text.split(' ')
    const total = parts.reduce((n, w) => n + w.length + 1, 0)
    const span = slot * 0.82
    let acc = 0
    return {
      timeMs,
      text,
      words: parts.map((w, wi) => {
        const t = Math.round(timeMs + (acc / total) * span)
        acc += w.length + 1
        return { timeMs: t, text: wi < parts.length - 1 ? w + ' ' : w }
      })
    }
  })
}

export function demoLyrics(trackId: string): LyricsResult {
  const track = DEMO_TRACKS.find((t) => t.id === trackId)
  const raw = DEMO_LYRICS[trackId]
  const matched = track && { title: track.title, artist: track.artists[0] ?? '', durationMs: track.durationMs }
  if (DEMO_INSTRUMENTAL.has(trackId)) return { trackId, status: 'instrumental', provider: 'demo', lines: [], matched }
  if (!track || !raw) return { trackId, status: 'none', provider: 'demo', lines: [] }
  if (DEMO_PLAIN_ONLY.has(trackId)) return { trackId, status: 'plain', provider: 'demo', lines: [], plain: raw.join('\n'), matched }
  const wordSynced = DEMO_WORD_SYNCED.has(trackId)
  return { trackId, status: 'synced', provider: 'demo', lines: schedule(raw, track.durationMs, wordSynced), wordSynced, matched }
}
