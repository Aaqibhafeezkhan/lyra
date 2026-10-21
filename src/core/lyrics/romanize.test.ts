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
})
