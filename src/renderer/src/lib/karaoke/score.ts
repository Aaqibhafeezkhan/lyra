/**
 * The karaoke score. Honest about what it can know: it hears WHEN you sing (voice against the lyric timing) and HOW
 * CLEANLY (how close each held note is to a note of the scale, steadiness), not whether it is the song's own melody:
 * a plain karaoke video carries no melody to compare with.
 *
 *   line points = coverage (share of the line you sang) x (0.6 + 0.4 x tuning)  -> 0..100
 *   streak: lines in a row at 60 or more points; every 3 in a row adds 10%
 */
export interface KLine {
  startMs: number
  endMs: number
  text: string
}

/** One microphone reading, taken about 20 times a second. */
export interface Frame {
  tMs: number
  /** the voice is clearly louder than the room (and than the backing track leaking in) */
  voiced: boolean
  /** distance from the nearest note in cents, only when a clear pitch was heard */
  cents: number | null
}

export interface LineResult {
  index: number
  text: string
  coverage: number // 0..1
  tuning: number // 0..1, 1 = every held note right on a note of the scale
  points: number // 0..100
  grade: 'perfect' | 'great' | 'ok' | 'miss'
}

export function grade(points: number): LineResult['grade'] {
  return points >= 85 ? 'perfect' : points >= 65 ? 'great' : points >= 35 ? 'ok' : 'miss'
}

/** Turns the frames of one line into its result. */
export function scoreLine(index: number, line: KLine, frames: Frame[]): LineResult {
  const inLine = frames.filter((f) => f.tMs >= line.startMs && f.tMs < line.endMs)
  const voiced = inLine.filter((f) => f.voiced)
  // a line is sung "fully" when you voice about 70% of it (breaths and consonants fill the rest)
  const coverage = inLine.length ? Math.min(1, voiced.length / (inLine.length * 0.7)) : 0
  const tuned = voiced.filter((f) => f.cents !== null)
  let tuning = 0.5 // no clear note heard (spoken, whispered, very short): neither reward nor punish much
  if (tuned.length >= 5) {
    // 0 cents off = 1, 50 cents (halfway between two notes) = 0
    tuning = tuned.reduce((a, f) => a + (1 - Math.min(50, Math.abs(f.cents!)) / 50), 0) / tuned.length
  }
  const points = Math.round(100 * coverage * (0.6 + 0.4 * tuning))
  return { index, text: line.text, coverage, tuning, points, grade: grade(points) }
}

export interface Summary {
  total: number // 0..10000
  stars: number // 0..5
  lines: LineResult[]
  bestStreak: number
  sungShare: number // share of lines at "ok" or better
}

/** The whole performance. */
export function summarize(results: LineResult[]): Summary {
  let streak = 0
  let best = 0
  let total = 0
  for (const r of results) {
    if (r.points >= 60) streak++
    else streak = 0
    best = Math.max(best, streak)
    const multiplier = 1 + 0.1 * Math.floor(streak / 3)
    total += Math.round(r.points * multiplier)
  }
  const maxPoints = Math.max(1, results.length * 100)
  const ratio = Math.min(1, total / maxPoints)
  const stars = ratio >= 0.9 ? 5 : ratio >= 0.75 ? 4 : ratio >= 0.55 ? 3 : ratio >= 0.35 ? 2 : ratio >= 0.15 ? 1 : 0
  const sung = results.filter((r) => r.grade !== 'miss').length
  return { total: Math.round(ratio * 10000), stars, lines: results, bestStreak: best, sungShare: results.length ? sung / results.length : 0 }
}
