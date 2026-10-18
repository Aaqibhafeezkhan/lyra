import type { LyricLine, LyricWord } from './types'

/**
 * Estimated word-by-word timing for line-synced lyrics.
 *
 * Free lyric sources only give one timestamp per line, so each line's time window is shared out between its words
 * in proportion to how long they take to sing (syllables), with a small pause after commas and a longer one after
 * full stops. It is an estimate, not true karaoke timing, and is only used when the source has no word times.
 */

/** Rough English syllable count (vowel groups, minus silent final "e"). Non-words (digits, symbols) count as one. */
export function syllables(word: string): number {
  // Indic scripts, Arabic, CJK...: each base letter carries about one syllable (vowel signs are separate marks)
  const letters = word.replace(/[^\p{L}]/gu, '')
  if (letters && !/[a-z]/i.test(letters)) return Math.max(1, [...letters].length)
  const w = word.toLowerCase().replace(/[^a-z']/g, '')
  if (!w) return 1
  let n = (w.replace(/'/g, '').match(/[aeiouy]+/g) ?? []).length
  if (n > 1 && /[^aeiouy]e$/.test(w) && !/(le|ye)$/.test(w)) n-- // "love", "time"
  if (n > 1 && /(ed)$/.test(w) && !/[td]ed$/.test(w)) n-- // "loved", "walked"
  return Math.max(1, n)
}

function pauseAfter(word: string): number {
  if (/[.!?…]["')\]]*$/.test(word)) return 0.9
  if (/[,;:—–-]["')\]]*$/.test(word)) return 0.45
  return 0
}

const SYLLABLE_MS = 330
/** Lines with a gap longer than this are probably followed by an instrumental break. */
const LONG_GAP_MS = 6000

export function estimateWords(lines: readonly LyricLine[], durationMs?: number): LyricLine[] {
  return lines.map((line, i) => {
    if (line.words && line.words.length > 1) return line // real timing wins
    const tokens = line.text.match(/\S+/g)
    if (!tokens || tokens.length < 2 || !/[\p{L}\p{N}]/u.test(line.text)) return line

    const nextStart = lines[i + 1]?.timeMs ?? (durationMs && durationMs > line.timeMs ? durationMs : line.timeMs + 5000)
    const avail = Math.max(400, nextStart - line.timeMs)

    const weights = tokens.map((t, k) => syllables(t) + (k < tokens.length - 1 ? pauseAfter(t) : 0))
    const total = weights.reduce((a, b) => a + b, 0)

    // Sung through to the next line, unless the gap is long (then the words finish and the line holds)
    const sung = total * SYLLABLE_MS
    const window = avail <= LONG_GAP_MS ? avail * 0.92 : Math.min(avail * 0.92, Math.max(5500, sung * 2))

    let acc = 0
    const words: LyricWord[] = tokens.map((t, k) => {
      const timeMs = Math.round(line.timeMs + (acc / total) * window)
      acc += weights[k]!
      return { timeMs, text: k < tokens.length - 1 ? t + ' ' : t }
    })
    return { ...line, words, endMs: Math.round(line.timeMs + window) }
  })
}
