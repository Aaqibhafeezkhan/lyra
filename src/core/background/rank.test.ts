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

describe('auto-accept is strict', () => {
  const want = { title: 'Barsaat', artist: 'Banjaare', durationMs: 185_000 }
  it('rejects lyric videos even from a plausible channel', () => {
    expect(rankVideos(want, [v('l', 'Banjaare - Barsaat (Lyric Video)', 'Banjaare', 185)])[0]!.acceptable).toBe(false)
  })
  it('rejects auto-generated Topic channels', () => {
    expect(rankVideos(want, [v('t', 'Barsaat', 'Banjaare - Topic', 185)])[0]!.acceptable).toBe(false)
  })
  it('rejects live uploads', () => {
    expect(rankVideos(want, [v('x', 'Banjaare - Barsaat (Live at Wembley)', 'Banjaare', 185)])[0]!.acceptable).toBe(false)
  })
  it('accepts an official upload from the artist channel', () => {
    expect(rankVideos(want, [v('o', 'Banjaare - Barsaat (Official Video)', 'Banjaare', 186)])[0]!.acceptable).toBe(true)
  })
})

describe('fan edits and clips are never auto-played', () => {
  const want = { title: 'Barsaat', artist: 'Banjaare', durationMs: 185_000 }
  it('rejects movie-scene edits even with an official-looking title', () => {
    expect(rankVideos(want, [v('s', 'Barsaat Official Video Banjaare spiderman movie scene whatsapp status', 'Banjaare Music', 185)])[0]!.acceptable).toBe(false)
  })
  it('rejects a video that is far from the song length', () => {
    expect(rankVideos(want, [v('d', 'Banjaare - Barsaat (Official Video)', 'Banjaare', 241)])[0]!.acceptable).toBe(false)
  })
  it('still accepts the official video within 30 s of the song length', () => {
    expect(rankVideos(want, [v('o', 'Banjaare - Barsaat (Official Video)', 'Banjaare', 205)])[0]!.acceptable).toBe(true)
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
