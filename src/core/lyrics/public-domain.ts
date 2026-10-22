import { platform } from '../platform'
import { LyricsProviderError, type LyricsProvider, type LyricsQuery, type ProviderResult } from './provider'
import { normalize, titleVariants } from './match'

/**
 * PublicDomainOnly's public-domain collection is a narrow, keyless fallback for older songs.
 * Its maintainer describes these entries as public domain in the United States; status can vary
 * by country. We intentionally do not use the separate CC0-generated-song catalogue.
 */
const DATA_URL = 'https://raw.githubusercontent.com/kennethyork/PubDomainOnly/main/lyrics_data.json'

interface PublicDomainRecord {
  title: string
  author?: string
  lyrics: string
  year?: string
  source_url?: string
}

type Fetcher = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export class PublicDomainLyricsProvider implements LyricsProvider {
  readonly id = 'public-domain'
  readonly name = 'Public-domain lyrics'
  private recordsPromise: Promise<PublicDomainRecord[]> | null = null

  constructor(private readonly fetcher: Fetcher = (url, init) => platform().fetch(url, init)) {}

  async fetch(q: LyricsQuery, signal: AbortSignal): Promise<ProviderResult> {
    const titleKeys = new Set(titleVariants(q.title).map(normalize).filter(Boolean))
    if (titleKeys.size === 0) return { kind: 'none' }

    const records = await this.load()
    if (signal.aborted) return { kind: 'none' }
    const matches = records.filter((record) => {
      if (!record.title?.trim() || !record.lyrics?.trim()) return false
      return titleKeys.has(normalize(record.title))
    })
    if (matches.length === 0) return { kind: 'none' }

    const wantedArtist = normalize(q.artist)
    const artistMatches = wantedArtist
      ? matches.filter((record) => normalize(record.author ?? '') === wantedArtist)
      : []
    const record = artistMatches.length === 1 ? artistMatches[0] : matches.length === 1 ? matches[0] : null
    if (!record) return { kind: 'none' }
    // A one-word title ("America", "Home", "Evening") says too little: a modern song with that name would get an old
    // song's words. Accept it only when the artist is the catalogue's author.
    const words = normalize(q.title).split(' ').filter(Boolean).length
    if (words < 2 && artistMatches.length !== 1) return { kind: 'none' }

    return {
      kind: 'found',
      plain: record.lyrics.trim(),
      matched: {
        title: record.title.trim(),
        artist: q.artist || record.author || 'Unknown',
        durationMs: q.durationMs
      }
    }
  }

  private load(): Promise<PublicDomainRecord[]> {
    if (!this.recordsPromise) {
      // its own timeout: the catalogue (about 0.8 MB) is shared by every lookup, so it must not be cancelled with the first one
      const signal = AbortSignal.timeout(20_000)
      this.recordsPromise = this.fetcher(DATA_URL, {
        headers: { Accept: 'application/json' },
        signal
      }).then(async (response) => {
        if (!response.ok) {
          throw new LyricsProviderError(`Public-domain lyrics catalogue unavailable (${response.status}).`, 'server')
        }
        const data: unknown = await response.json()
        if (!Array.isArray(data)) {
          throw new LyricsProviderError('Public-domain lyrics catalogue returned invalid data.', 'server', false)
        }
        return data as PublicDomainRecord[]
      }).catch((error: unknown) => {
        this.recordsPromise = null
        if (error instanceof LyricsProviderError) throw error
        throw new LyricsProviderError(`Could not load public-domain lyrics: ${(error as Error).message}`, 'network')
      })
    }
    return this.recordsPromise
  }
}
