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

export interface Matched {
  title: string
  artist: string
  durationMs: number
}

export type ProviderResult =
  | {
      kind: 'found'
      /** LRC or enhanced-LRC text */
      synced?: string
      plain?: string
      instrumental?: boolean
      matched: Matched
    }
  | { kind: 'none' }

/** A possible match the user can pick when the automatic one is wrong. */
export interface LyricsCandidate {
  /** Provider-specific id, passed back to `byId`. */
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
  synced: boolean
  instrumental: boolean
}

export class LyricsProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'rate-limit' | 'server' | 'unknown',
    readonly retryable = true,
    /** Seconds the provider asked us to wait (rate limits). */
    readonly retryAfterSec?: number
  ) {
    super(message)
  }
}

export interface LyricsProvider {
  readonly id: string
  readonly name: string
  fetch(q: LyricsQuery, signal: AbortSignal): Promise<ProviderResult>
  /** Optional: ranked alternatives for manual correction. */
  candidates?(q: LyricsQuery, signal: AbortSignal): Promise<LyricsCandidate[]>
  /** Optional: fetch one specific entry (used for user-pinned matches). */
  byId?(id: string, signal: AbortSignal): Promise<ProviderResult>
}

export { cleanTitle } from './match'
