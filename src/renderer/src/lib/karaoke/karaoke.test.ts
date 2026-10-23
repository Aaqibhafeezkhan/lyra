import { describe, expect, it } from 'vitest'
import { rankKaraoke, type VideoCandidate } from '@core/background/rank'
import { centsFromNearestNote, detectPitch, rms } from './pitch'
import { scoreLine, summarize, type Frame } from './score'

const RATE = 48000
const tone = (hz: number, n = 2048, amp = 0.5): Float32Array => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE))

describe('detectPitch', () => {
  it('finds the pitch of sung-range tones', () => {
    for (const hz of [110, 196, 261.63, 440, 659.25]) {
      const p = detectPitch(tone(hz), RATE)
      expect(p, `${hz} Hz`).not.toBeNull()
      expect(Math.abs(p!.hz - hz) / hz).toBeLessThan(0.01)
      expect(p!.clarity).toBeGreaterThan(0.9)
    }
  })

  it('hears nothing in noise and in silence', () => {
    const noise = Float32Array.from({ length: 2048 }, () => (Math.random() * 2 - 1) * 0.3)
    expect(detectPitch(noise, RATE)).toBeNull()
    expect(detectPitch(new Float32Array(2048), RATE)).toBeNull()
  })

  it('measures how far a tone is from the nearest note', () => {
    expect(Math.abs(centsFromNearestNote(440))).toBeLessThan(0.5)
    expect(centsFromNearestNote(440 * Math.pow(2, 0.25 / 12))).toBeCloseTo(25, 0) // a quarter tone sharp
    expect(Math.abs(rms(tone(220, 1000, 0.5)) - 0.5 / Math.SQRT2)).toBeLessThan(0.01)
  })
})

const frames = (from: number, to: number, voiced: boolean, cents: number | null = 0): Frame[] => {
  const out: Frame[] = []
  for (let t = from; t < to; t += 50) out.push({ tMs: t, voiced, cents: voiced ? cents : null })
  return out
}
const line = { startMs: 0, endMs: 4000, text: 'la la la' }

describe('scoreLine', () => {
  it('rewards a line sung through and in tune', () => {
    const r = scoreLine(0, line, frames(0, 4000, true, 3))
    expect(r.points).toBeGreaterThanOrEqual(90)
    expect(r.grade).toBe('perfect')
  })

  it('gives little for a line that was not sung', () => {
    const r = scoreLine(0, line, frames(0, 4000, false))
    expect(r.points).toBe(0)
    expect(r.grade).toBe('miss')
  })

  it('takes points off for out-of-tune singing, not all of them', () => {
    const inTune = scoreLine(0, line, frames(0, 4000, true, 2)).points
    const off = scoreLine(0, line, frames(0, 4000, true, 45)).points
    expect(off).toBeLessThan(inTune)
    expect(off).toBeGreaterThan(50)
  })

  it('gives half the line for half the time', () => {
    const r = scoreLine(0, line, [...frames(0, 2000, true, 0), ...frames(2000, 4000, false)])
    expect(r.coverage).toBeGreaterThan(0.6)
    expect(r.coverage).toBeLessThan(0.85)
  })
})

describe('summarize', () => {
  it('adds up, counts the best streak and gives stars', () => {
    const sung = scoreLine(0, line, frames(0, 4000, true, 0))
    const missed = scoreLine(1, line, frames(0, 4000, false))
    const s = summarize([sung, sung, sung, sung, missed, sung])
    expect(s.bestStreak).toBe(4)
    expect(s.total).toBeGreaterThan(6000)
    expect(s.stars).toBeGreaterThanOrEqual(3)
    expect(summarize([missed, missed]).stars).toBe(0)
  })
})

const v = (videoId: string, title: string, channel: string, durationSec: number, embeddable = true): VideoCandidate => ({ videoId, title, channel, durationSec, embeddable })

describe('rankKaraoke', () => {
  const want = { title: 'Barsaat', artist: 'Banjaare', durationMs: 185_000 }
  it('prefers a karaoke version of the same song and length', () => {
    const r = rankKaraoke(want, [
      v('orig', 'Banjaare - Barsaat (Official Video)', 'Banjaare', 185),
      v('cover', 'Barsaat cover by someone', 'Random', 190),
      v('kar', 'Barsaat - Banjaare (Karaoke Version)', 'Sing King', 186),
      v('other', 'Another Song (Karaoke)', 'Sing King', 185)
    ])
    expect(r[0]!.videoId).toBe('kar')
    expect(r[0]!.acceptable).toBe(true)
    expect(r.find((x) => x.videoId === 'orig')?.acceptable ?? false).toBe(false)
  })

  it('does not accept a karaoke video of a different length', () => {
    const r = rankKaraoke(want, [v('long', 'Barsaat Banjaare karaoke', 'Karaoke Hub', 420)])
    expect(r[0]?.acceptable ?? false).toBe(false)
  })

  it('drops videos that cannot be embedded', () => {
    expect(rankKaraoke(want, [v('n', 'Barsaat karaoke Banjaare', 'Sing King', 185, false)])).toHaveLength(0)
  })
})
