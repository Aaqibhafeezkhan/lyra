/**
 * Lyrics providers are replaceable: implement `LyricsProvider`, add it to the chain in service.ts.
 * Providers must use a documented, permitted API — no scraping, no bypassing access controls.
 */
export interface LyricsQuery {
  trackId: string
  title: string
  artist: string
  album: string
  durationMs: number
}

export type ProviderResult =
  | {
      kind: 'found'
      /** LRC or enhanced-LRC text */
      synced?: string
      plain?: string
      instrumental?: boolean
      matched: { title: string; artist: string; durationMs: number }
    }
  | { kind: 'none' }

export class LyricsProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'rate-limit' | 'server' | 'unknown',
    readonly retryable = true
  ) {
    super(message)
  }
}

export interface LyricsProvider {
  readonly id: string
  readonly name: string
  fetch(q: LyricsQuery, signal: AbortSignal): Promise<ProviderResult>
}

/** Remove noise that makes catalog matching fail: "(feat. X)", "- Remastered 2011", "- Live at ...". */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:feat\.?|ft\.?|with)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|live|mono|stereo|radio edit|single version|album version|bonus track|deluxe)\b.*$/i, '')
    .replace(/\s*[([](?:\d{4}\s*)?(?:remaster(?:ed)?|live|mono|stereo|radio edit)[^)\]]*[)\]]/gi, '')
    .trim()
}
