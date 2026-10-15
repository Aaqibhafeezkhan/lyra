import type { LyricLine, LyricWord } from './types'

const LINE_STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const WORD_STAMP = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]$/i

function toMs(min: string, sec: string, frac?: string): number {
  const ms = frac ? parseInt(frac.padEnd(3, '0').slice(0, 3), 10) : 0
  return (parseInt(min, 10) * 60 + parseInt(sec, 10)) * 1000 + ms
}

function parseWords(body: string): LyricWord[] | undefined {
  const matches = [...body.matchAll(WORD_STAMP)]
  if (matches.length === 0) return undefined
  const words: LyricWord[] = []
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length
    const end = matches[i + 1]?.index ?? body.length
    const text = body.slice(start, end)
    if (text.trim().length === 0) return // trailing end-marker
    words.push({ timeMs: toMs(m[1]!, m[2]!, m[3]), text })
  })
  return words.length > 0 ? words : undefined
}

/**
 * Parse LRC (and enhanced LRC with <mm:ss.xx> word stamps) into sorted lines.
 * Lines without any timestamp are ignored; callers fall back to plain text.
 */
export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = []
  let offset = 0

  for (const raw of source.split(/\r?\n/)) {
    const row = raw.trim()
    if (!row) continue
    const off = OFFSET_TAG.exec(row)
    if (off) {
      offset = parseInt(off[1]!, 10)
      continue
    }
    const stamps = [...row.matchAll(LINE_STAMP)]
    if (stamps.length === 0) continue
    const last = stamps[stamps.length - 1]!
    const body = row.slice((last.index ?? 0) + last[0].length)
    const words = parseWords(body)
    const text = body.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim()
    for (const s of stamps) {
      lines.push({ timeMs: Math.max(0, toMs(s[1]!, s[2]!, s[3]) + offset), text, ...(words ? { words } : {}) })
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

/** Index of the line active at `positionMs` (-1 before first line). Binary search. */
export function findActiveLine(lines: readonly LyricLine[], positionMs: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid]!.timeMs <= positionMs) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Strip any timestamps to get readable plain text. */
export function stripLrc(source: string): string {
  return source
    .split(/\r?\n/)
    .map((l) => l.replace(LINE_STAMP, '').replace(WORD_STAMP, '').trim())
    .filter((l, i, a) => !/^\[[a-z]+:.*\]$/i.test(l) && !(l === '' && a[i - 1] === ''))
    .join('\n')
    .trim()
}
