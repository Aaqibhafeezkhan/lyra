import { describe, expect, it } from 'vitest'
import { romanizeLyrics } from './romanize'

describe('romanizeLyrics', () => {
  it('transliterates Devanagari Hindi', () => {
    expect(romanizeLyrics('नमस्ते')).toBe('namaste')
  })

  it('transliterates Gurmukhi Punjabi', () => {
    expect(romanizeLyrics('ਪੰਜਾਬੀ')).toBe('panjabi')
  })

  it('leaves Latin lyrics unchanged', () => {
    expect(romanizeLyrics('Hello world')).toBe('Hello world')
  })

  it('preserves punctuation', () => {
    expect(romanizeLyrics('नमस्ते!')).toBe('namaste!')
  })

  // words that end in a long vowel must keep it (tera, ka, jyada), the inherent "a" of a final consonant must go (yaad -> yad)
  it('keeps word-final long vowels', () => {
    expect(romanizeLyrics('तेरा')).toBe('tera')
    expect(romanizeLyrics('का')).toBe('ka')
    expect(romanizeLyrics('ज्यादा')).toBe('jyada')
    expect(romanizeLyrics('ਤੇਰਾ')).toBe('tera')
  })

  it('drops the silent final "a"', () => {
    expect(romanizeLyrics('याद')).toBe('yad')
    expect(romanizeLyrics('प्यार')).toBe('pyar')
    expect(romanizeLyrics('समझ')).toBe('samajh')
  })

  it('drops the silent "a" between syllables', () => {
    expect(romanizeLyrics('लड़की')).toBe('larki')
    expect(romanizeLyrics('समझना')).toBe('samajhna')
  })

  it('writes a stand-alone vowel and keeps the one before a nasal', () => {
    expect(romanizeLyrics('आ जा')).toBe('a ja')
    expect(romanizeLyrics('ज़िंदगी')).toBe('zindagi')
  })

  it('transliterates whole lines', () => {
    expect(romanizeLyrics('तेरी याद आवेगी')).toBe('teri yad avegi')
    expect(romanizeLyrics('ਮੇਰੇ ਨਾਲ')).toBe('mere nal')
    expect(romanizeLyrics('तू मेरी राज़दार रहे')).toBe('tu meri razdar rahe')
  })
})
