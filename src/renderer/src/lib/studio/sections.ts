import type { LyricLine } from '@shared/types'

export interface Section {
  startMs: number
  endMs: number
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * The part of a song people most want to post: the chorus. Finds the longest run of lines that appears again later
 * (a repeated stanza) and returns its first occurrence, capped at 30 s. Falls back to the first 30 s.
 */
export function autoChorus(lines: readonly LyricLine[], durationMs: number): Section {
  const text = lines.map((l) => norm(l.text))
  let best = { i: -1, len: 0 }
  for (let i = 0; i < text.length; i++) {
    if (!text[i]) continue
    for (let k = i + 1; k < text.length; k++) {
      if (text[k] !== text[i]) continue
      let len = 0
      while (i + len < k && k + len < text.length && text[i + len] === text[k + len] && text[i + len]) len++
      if (len > best.len) best = { i, len }
    }
  }
  if (best.i < 0 || best.len < 2 || lines.length === 0) return { startMs: 0, endMs: Math.min(durationMs, 30_000) }
  const startMs = Math.max(0, lines[best.i]!.timeMs - 400)
  const after = lines[best.i + best.len]
  const natural = (after ? after.timeMs : lines[best.i + best.len - 1]!.timeMs + 4000) + 300
  return { startMs, endMs: Math.min(durationMs, Math.min(natural, startMs + 30_000)) }
}
