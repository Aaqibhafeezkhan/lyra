import { describe, expect, it } from 'vitest'
import { estimateWords, syllables } from './wordTiming'

describe('syllables', () => {
  it('counts common words', () => {
    expect(syllables('love')).toBe(1)
    expect(syllables('time')).toBe(1)
    expect(syllables('baby')).toBe(2)
    expect(syllables('beautiful')).toBe(3)
    expect(syllables('loved')).toBe(1)
    expect(syllables('wanted')).toBe(2)
    expect(syllables('little')).toBe(2)
    expect(syllables('oh,')).toBe(1)
    expect(syllables('2am')).toBe(1)
    expect(syllables('ਸੋਹਣਿਆਂ')).toBe(4) // Gurmukhi: 4 base letters
    expect(syllables('ਤੇ')).toBe(1)
  })
})

describe('estimateWords', () => {
  const lines = [
    { timeMs: 1000, text: 'Oh my love, I need you' },
    { timeMs: 5000, text: 'Hold me tight' },
    { timeMs: 20000, text: 'Beautiful morning' }
  ]
  it('gives every word a time inside its line window, in order', () => {
    const out = estimateWords(lines, 60000)
    const w = out[0]!.words!
    expect(w.map((x) => x.text.trim()).join(' ')).toBe('Oh my love, I need you')
    expect(w[0]!.timeMs).toBe(1000)
    for (let i = 1; i < w.length; i++) expect(w[i]!.timeMs).toBeGreaterThan(w[i - 1]!.timeMs)
    expect(w[w.length - 1]!.timeMs).toBeLessThan(5000)
    expect(out[0]!.endMs!).toBeLessThanOrEqual(5000)
  })
  it('pauses after a comma (the next word starts later than a plain word would)', () => {
    const w = estimateWords(lines, 60000)[0]!.words!
    const gapAfterComma = w[3]!.timeMs - w[2]!.timeMs // "love," -> "I"
    const gapPlain = w[2]!.timeMs - w[1]!.timeMs // "my" -> "love,"  (1 syllable each)
    expect(gapAfterComma).toBeGreaterThan(gapPlain)
  })
  it('stops early when a long instrumental gap follows, instead of crawling', () => {
    const out = estimateWords(lines, 60000)
    expect(out[1]!.endMs! - 5000).toBeLessThan(6500) // 15 s gap, but a 3-word line
  })
  it('keeps real word timing and leaves single words / symbols alone', () => {
    const real = [{ timeMs: 0, text: 'a b', words: [{ timeMs: 0, text: 'a ' }, { timeMs: 100, text: 'b' }] }, { timeMs: 3000, text: '♪' }, { timeMs: 4000, text: 'Hey' }]
    const out = estimateWords(real, 9000)
    expect(out[0]).toBe(real[0])
    expect(out[1]!.words).toBeUndefined()
    expect(out[2]!.words).toBeUndefined()
  })
})
