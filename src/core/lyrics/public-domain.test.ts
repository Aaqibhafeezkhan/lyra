import { describe, expect, it, vi } from 'vitest'
import { LyricsProviderError } from './provider'
import { PublicDomainLyricsProvider } from './public-domain'

const record = {
  title: 'Amazing Grace',
  author: 'John Newton',
  lyrics: 'Amazing grace, how sweet the sound',
  year: '1779',
  source_url: 'https://example.org/amazing-grace'
}

const query = {
  trackId: 'track-1',
  title: 'Amazing Grace',
  artist: 'John Newton',
  album: '',
  durationMs: 180_000
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('PublicDomainLyricsProvider', () => {
  it('returns exact-title lyrics from the public-domain catalogue', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([record]))
    const provider = new PublicDomainLyricsProvider(fetcher)
    const result = await provider.fetch(query, new AbortController().signal)

    expect(result).toEqual({
      kind: 'found',
      plain: record.lyrics,
      matched: { title: 'Amazing Grace', artist: 'John Newton', durationMs: 180_000 }
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]![0]).toContain('PubDomainOnly/main/lyrics_data.json')
  })

  it('returns none when a matching catalogue entry has no lyrics', async () => {
    const provider = new PublicDomainLyricsProvider(vi.fn().mockResolvedValue(response([
      { ...record, lyrics: '' }
    ])))
    expect(await provider.fetch(query, new AbortController().signal)).toEqual({ kind: 'none' })
  })

  it('returns none when the title is absent or ambiguous', async () => {
    const provider = new PublicDomainLyricsProvider(vi.fn().mockResolvedValue(response([
      record,
      { ...record, author: 'Another author', lyrics: 'Different text' }
    ])))
    expect(await provider.fetch({ ...query, title: 'Different Song' }, new AbortController().signal)).toEqual({ kind: 'none' })
    expect(await provider.fetch({ ...query, artist: 'No matching author' }, new AbortController().signal)).toEqual({ kind: 'none' })
  })

  it('does not give a one-word modern title the lyrics of an old song', async () => {
    const provider = new PublicDomainLyricsProvider(vi.fn().mockResolvedValue(response([{ ...record, title: 'America', author: '' }])))
    expect(await provider.fetch({ ...query, title: 'America', artist: 'Simon & Garfunkel' }, new AbortController().signal)).toEqual({ kind: 'none' })
  })

  it('still matches a one-word title when the artist is the catalogue author', async () => {
    const provider = new PublicDomainLyricsProvider(vi.fn().mockResolvedValue(response([{ ...record, title: 'Dixie', author: 'Daniel Emmett' }])))
    const r = await provider.fetch({ ...query, title: 'Dixie', artist: 'Daniel Emmett' }, new AbortController().signal)
    expect(r.kind).toBe('found')
  })

  it('surfaces catalogue failures as provider errors', async () => {
    const provider = new PublicDomainLyricsProvider(vi.fn().mockRejectedValue(new Error('offline')))
    await expect(provider.fetch(query, new AbortController().signal)).rejects.toMatchObject({
      kind: 'network',
      retryable: true
    })
  })

  it('does not cache a failed catalogue load', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response([record]))
    const provider = new PublicDomainLyricsProvider(fetcher)
    await expect(provider.fetch(query, new AbortController().signal)).rejects.toBeInstanceOf(LyricsProviderError)
    expect((await provider.fetch(query, new AbortController().signal)).kind).toBe('found')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
