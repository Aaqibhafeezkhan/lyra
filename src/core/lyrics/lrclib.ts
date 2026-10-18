import { platform } from '../platform'
import {
  LyricsProviderError,
  type LyricsCandidate,
  type LyricsProvider,
  type LyricsQuery,
  type ProviderResult
} from './provider'
import { artistVariants, isAcceptable, scoreCandidate, titleVariants, type Candidate } from './match'

/**
 * LRCLIB (https://lrclib.net) — a free, community-run lyrics API that needs no key
 * and serves timestamped LRC. Their docs ask clients to send a descriptive User-Agent.
 */
const BASE = 'https://lrclib.net/api'

interface LrcLibRecord {
  id: number
  trackName: string
  artistName: string
  albumName?: string
  duration: number // seconds
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

const asCandidate = (r: LrcLibRecord): Candidate => ({
  title: r.trackName,
  artist: r.artistName,
  durationMs: Math.round((r.duration || 0) * 1000),
  synced: !!r.syncedLyrics
})

const MIN_GAP_MS = 600 // be a polite client: LRCLIB rate-limits aggressively
const DEFAULT_COOLDOWN_S = 30

export class LrcLibProvider implements LyricsProvider {
  readonly id = 'lrclib'
  readonly name = 'LRCLIB'
  private cooldownUntil = 0
  private lastRequest = 0
  private gate: Promise<void> = Promise.resolve()

  /** Serialises requests with a minimum gap so quick track skipping can't burst the API. */
  private throttle(): Promise<void> {
    const turn = this.gate.then(async () => {
      const wait = this.lastRequest + MIN_GAP_MS - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      this.lastRequest = Date.now()
    })
    this.gate = turn.catch(() => undefined)
    return turn
  }

  private async get<T>(path: string, signal: AbortSignal): Promise<{ status: number; body: T | null }> {
    const left = Math.ceil((this.cooldownUntil - Date.now()) / 1000)
    if (left > 0) throw new LyricsProviderError(`The lyrics service asked us to slow down. Retrying in ${left}s.`, 'rate-limit', true, left)
    await this.throttle()
    let res: Response
    try {
      res = await platform().fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': `Lyra/${platform().appVersion} (https://github.com/DhruvHarani1/lyra)`, Accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      })
    } catch (e) {
      if (signal.aborted) throw e
      throw new LyricsProviderError(`Can’t reach the lyrics service: ${(e as Error).message}`, 'network')
    }
    // 400 = this query shape isn't valid for the endpoint (e.g. empty field) — treat as "no result", not an outage
    if (res.status === 404 || res.status === 400) return { status: res.status, body: null }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'))
      const secs = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 300) : DEFAULT_COOLDOWN_S
      this.cooldownUntil = Date.now() + secs * 1000
      throw new LyricsProviderError(`The lyrics service is rate limiting requests. Retrying in ${secs}s.`, 'rate-limit', true, secs)
    }
    if (res.status >= 500) throw new LyricsProviderError(`Lyrics service error (${res.status}).`, 'server')
    if (!res.ok) throw new LyricsProviderError(`Unexpected lyrics response (${res.status}).`, 'unknown', false)
    return { status: res.status, body: (await res.json()) as T }
  }

  async fetch(q: LyricsQuery, signal: AbortSignal): Promise<ProviderResult> {
    const want = { title: q.title, artist: q.artist, durationMs: q.durationMs }
    const titles = titleVariants(q.title)
    const artists = artistVariants(q.artist)
    const dur = Math.round(q.durationMs / 1000)

    // 1) exact signature lookups (best precision), most specific variant first
    const tried = new Set<string>()
    for (const [i, title] of titles.entries()) {
      for (const artist of artists) {
        const key = `${title}|${artist}`
        if (tried.has(key) || tried.size >= 2) continue
        tried.add(key)
        const params = new URLSearchParams({ track_name: title, artist_name: artist })
        if (dur > 0) params.set('duration', String(dur))
        if (i === 0 && artist === artists[0] && q.album) params.set('album_name', q.album)
        const r = await this.get<LrcLibRecord>(`/get?${params}`, signal)
        if (r.body && isAcceptable(want, asCandidate(r.body))) return this.toResult(r.body)
      }
    }

    // 2) broader searches; take the best acceptable candidate
    const pool = await this.searchPool(q, signal)
    const best = pool
      .filter((r) => isAcceptable(want, asCandidate(r)))
      .sort((a, b) => scoreCandidate(want, asCandidate(b)) - scoreCandidate(want, asCandidate(a)))[0]
    return best ? this.toResult(best) : { kind: 'none' }
  }

  private async searchPool(q: LyricsQuery, signal: AbortSignal): Promise<LrcLibRecord[]> {
    const titles = titleVariants(q.title)
    const artist = artistVariants(q.artist).at(-1) ?? q.artist
    const title = titles.at(-1) ?? q.title
    const queries = [
      `/search?${new URLSearchParams({ q: `${artist} ${title}` })}`,
      `/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`,
      `/search?${new URLSearchParams({ track_name: title })}`
    ]
    const seen = new Map<number, LrcLibRecord>()
    for (const path of queries) {
      const r = await this.get<LrcLibRecord[]>(path, signal)
      for (const rec of r.body ?? []) seen.set(rec.id, rec)
      if (seen.size >= 1) break
    }
    return [...seen.values()]
  }

  async candidates(q: LyricsQuery, signal: AbortSignal): Promise<LyricsCandidate[]> {
    const want = { title: q.title, artist: q.artist, durationMs: q.durationMs }
    const pool = await this.searchPool(q, signal)
    return pool
      .filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
      .sort((a, b) => scoreCandidate(want, asCandidate(b)) - scoreCandidate(want, asCandidate(a)))
      .slice(0, 8)
      .map((r) => ({
        id: String(r.id),
        title: r.trackName,
        artist: r.artistName,
        album: r.albumName ?? '',
        durationMs: Math.round((r.duration || 0) * 1000),
        synced: !!r.syncedLyrics,
        instrumental: r.instrumental
      }))
  }

  async byId(id: string, signal: AbortSignal): Promise<ProviderResult> {
    if (!/^\d+$/.test(id)) return { kind: 'none' }
    const r = await this.get<LrcLibRecord>(`/get/${id}`, signal)
    return r.body ? this.toResult(r.body) : { kind: 'none' }
  }

  private toResult(r: LrcLibRecord): ProviderResult {
    const matched = { title: r.trackName, artist: r.artistName, durationMs: Math.round(r.duration * 1000) }
    if (r.instrumental) return { kind: 'found', instrumental: true, matched }
    if (!r.syncedLyrics && !r.plainLyrics) return { kind: 'none' }
    return { kind: 'found', synced: r.syncedLyrics ?? undefined, plain: r.plainLyrics ?? undefined, matched }
  }
}
