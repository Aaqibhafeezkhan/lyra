import { describe, expect, it } from 'vitest'
import { artistVariants, cleanTitle, isAcceptable, scoreCandidate, similarity, titleVariants } from './match'

describe('cleanTitle', () => {
  it('strips features, remaster and from-tags', () => {
    expect(cleanTitle('Song (feat. Someone)')).toBe('Song')
    expect(cleanTitle('Song - 2011 Remastered Version')).toBe('Song')
    expect(cleanTitle('Tum Hi Ho (From "Aashiqui 2")')).toBe('Tum Hi Ho')
    expect(cleanTitle('Name [Live]')).toBe('Name')
  })
  it('keeps real titles', () => {
    expect(cleanTitle('Live Forever')).toBe('Live Forever')
    expect(cleanTitle('Hello - Part 2')).toBe('Hello - Part 2')
  })
})

describe('variants', () => {
  it('splits series suffix after a pipe', () => {
    expect(titleVariants('Arz Kiya Hai | Coke Studio Bharat')).toContain('Arz Kiya Hai')
  })
  it('takes the primary artist', () => {
    expect(artistVariants('Daft Punk, Pharrell Williams')).toEqual(['Daft Punk, Pharrell Williams', 'Daft Punk'])
    expect(artistVariants('Anuv Jain')).toEqual(['Anuv Jain'])
  })
})

describe('similarity & scoring', () => {
  it('handles equal, subset and unrelated', () => {
    expect(similarity('Hello World', 'hello  world!')).toBe(1)
    expect(similarity('Song', 'Song Live')).toBeGreaterThan(0.8)
    expect(similarity('Alpha', 'Omega')).toBe(0)
  })
  const want = { title: 'Arz Kiya Hai | Coke Studio Bharat', artist: 'Anuv Jain', durationMs: 294500 }
  it('accepts the right song despite the suffix', () => {
    expect(isAcceptable(want, { title: 'Arz Kiya Hai', artist: 'Anuv Jain', durationMs: 294000, synced: true })).toBe(true)
  })
  it('rejects a different song and a far duration', () => {
    expect(isAcceptable(want, { title: 'Baarishein', artist: 'Anuv Jain', durationMs: 294500, synced: true })).toBe(false)
    expect(isAcceptable(want, { title: 'Arz Kiya Hai', artist: 'Anuv Jain', durationMs: 200000, synced: true })).toBe(false)
  })
  it('ranks exact duration + artist higher', () => {
    const good = scoreCandidate(want, { title: 'Arz Kiya Hai', artist: 'Anuv Jain', durationMs: 294500, synced: true })
    const meh = scoreCandidate(want, { title: 'Arz Kiya Hai', artist: 'Somebody Else', durationMs: 292000, synced: false })
    expect(good).toBeGreaterThan(meh)
  })
})
