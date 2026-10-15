import { app, net } from 'electron'
import { LyricsProviderError, cleanTitle, type LyricsProvider, type LyricsQuery, type ProviderResult } from './provider'

/**
 * LRCLIB (https://lrclib.net) — a free, community-run lyrics API that needs no key
 * and serves timestamped LRC. Their docs ask clients to send a descriptive User-Agent.
 */
const BASE = 'https://lrclib.net/api'

interface LrcLibRecord {
  trackName: string
  artistName: string
  albumName?: string
  duration: number // seconds
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

const DURATION_TOLERANCE_S = 4

export class LrcLibProvider implements LyricsProvider {
  readonly id = 'lrclib'
  readonly name = 'LRCLIB'

  private async get<T>(path: string, signal: AbortSignal): Promise<{ status: number; body: T | null }> {
    let res: Response
    try {
      res = await net.fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': `Lyra/${app.getVersion()} (desktop lyrics companion)`, Accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      })
    } catch (e) {
      if (signal.aborted) throw e
      throw new LyricsProviderError(`Can’t reach the lyrics service: ${(e as Error).message}`, 'network')
    }
    if (res.status === 404) return { status: 404, body: null }
    if (res.status === 429) throw new LyricsProviderError('The lyrics service is rate limiting requests.', 'rate-limit')
    if (res.status >= 500) throw new LyricsProviderError(`Lyrics service error (${res.status}).`, 'server')
    if (!res.ok) throw new LyricsProviderError(`Unexpected lyrics response (${res.status}).`, 'unknown', false)
    return { status: res.status, body: (await res.json()) as T }
  }

  async fetch(q: LyricsQuery, signal: AbortSignal): Promise<ProviderResult> {
    const title = cleanTitle(q.title)
    const artist = q.artist
    const dur = Math.round(q.durationMs / 1000)

    // 1) exact signature lookup (best precision)
    const exact = await this.get<LrcLibRecord>(
      `/get?${new URLSearchParams({ track_name: title, artist_name: artist, album_name: q.album, duration: String(dur) })}`,
      signal
    )
    if (exact.body && this.durationOk(exact.body, dur)) return this.toResult(exact.body)

    // 2) search, choose closest by duration, prefer synced
    const search = await this.get<LrcLibRecord[]>(`/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`, signal)
    const candidates = (search.body ?? []).filter((r) => this.durationOk(r, dur))
    if (candidates.length === 0) return { kind: 'none' }
    candidates.sort(
      (a, b) =>
        Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || Math.abs(a.duration - dur) - Math.abs(b.duration - dur)
    )
    return this.toResult(candidates[0]!)
  }

  private durationOk(r: LrcLibRecord, wantS: number): boolean {
    return !wantS || !r.duration || Math.abs(r.duration - wantS) <= DURATION_TOLERANCE_S
  }

  private toResult(r: LrcLibRecord): ProviderResult {
    const matched = { title: r.trackName, artist: r.artistName, durationMs: Math.round(r.duration * 1000) }
    if (r.instrumental) return { kind: 'found', instrumental: true, matched }
    if (!r.syncedLyrics && !r.plainLyrics) return { kind: 'none' }
    return { kind: 'found', synced: r.syncedLyrics ?? undefined, plain: r.plainLyrics ?? undefined, matched }
  }
}
