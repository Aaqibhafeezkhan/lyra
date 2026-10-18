import { describe, expect, it } from 'vitest'
import { cleanVideoTitle, parseIsoDuration, rankVideos, type VideoCandidate } from './rank'

const v = (videoId: string, title: string, channel: string, durationSec: number, embeddable = true): VideoCandidate => ({
  videoId,
  title,
  channel,
  durationSec,
  embeddable
})

describe('cleanVideoTitle', () => {
  it('strips official/video/hd noise', () => {
    expect(cleanVideoTitle('Barsaat (Official Video) | Banjaare')).toBe('Barsaat | Banjaare')
    expect(cleanVideoTitle('Song Name [Official Music Video] [4K]')).toBe('Song Name')
  })
})

describe('rankVideos', () => {
  const want = { title: 'Barsaat', artist: 'Banjaare, Roni', durationMs: 185_000 }
  it('prefers the official video over lyric/cover versions', () => {
    const r = rankVideos(want, [
      v('lyr', 'Barsaat (Lyrics) - Banjaare', 'Lyric Hub', 186),
      v('cov', 'Barsaat cover by someone', 'Random', 190),
      v('off', 'Barsaat | Banjaare | Official Video', 'Banjaare', 187)
    ])
    expect(r[0]!.videoId).toBe('off')
    expect(r[0]!.acceptable).toBe(true)
  })
  it('does not auto-accept an unrelated video', () => {
    const r = rankVideos(want, [v('x', 'Totally different song', 'Other Artist', 185)])
    expect(r[0]!.acceptable).toBe(false)
  })
  it('drops non-embeddable videos entirely', () => {
    expect(rankVideos(want, [v('n', 'Barsaat Official Video Banjaare', 'Banjaare', 185, false)])).toHaveLength(0)
  })
  it('uses duration to break ties', () => {
    const r = rankVideos(want, [v('a', 'Barsaat Official Video Banjaare', 'Banjaare', 400), v('b', 'Barsaat Official Video Banjaare', 'Banjaare', 186)])
    expect(r[0]!.videoId).toBe('b')
  })
})

describe('parseIsoDuration', () => {
  it('parses common shapes', () => {
    expect(parseIsoDuration('PT3M5S')).toBe(185)
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration(undefined)).toBeNull()
  })
})
