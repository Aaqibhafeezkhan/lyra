import { parseLrc, stripLrc } from '@shared/lrc'
import type { LyricsResult, Track } from '@shared/types'
import { logger, platform, type BlobCache, type Store } from '../platform'
import { demoLyrics } from '../demo/lyrics'
import { LrcLibProvider } from './lrclib'
import { PublicDomainLyricsProvider } from './public-domain'
import { LyricsProviderError, type LyricsCandidate, type LyricsProvider, type LyricsQuery } from './provider'

const log = logger('lyrics')

const FOUND_TTL = 30 * 24 * 3600_000
const NONE_TTL = 12 * 3600_000
const MAX_DISK_ENTRIES = 600

interface CacheEntry {
  at: number
  result: LyricsResult
}

interface Pin {
  provider: string
  id: string
}

class LyricsService {
  private pinStore: Store<{ pins: Record<string, Pin> }> | null = null
  private readonly providers: LyricsProvider[] = [new LrcLibProvider(), new PublicDomainLyricsProvider()]
  private readonly memory = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<LyricsResult>>()
  private blob: BlobCache | null = null
  private lastCall = 0

  private disk(): BlobCache {
    return (this.blob ??= platform().blobCache('lyrics-cache', MAX_DISK_ENTRIES))
  }

  private readCache(id: string): LyricsResult | null {
    const now = Date.now()
    const mem = this.memory.get(id)
    const entry = mem ?? this.readDisk(id)
    if (!entry) return null
    const ttl = entry.result.status === 'none' ? NONE_TTL : FOUND_TTL
    if (now - entry.at > ttl) return null
    this.memory.set(id, entry)
    return entry.result
  }

  private readDisk(id: string): CacheEntry | null {
    try {
      const raw = this.disk().read(id)
      return raw ? (JSON.parse(raw) as CacheEntry) : null
    } catch {
      return null
    }
  }

  private writeCache(id: string, result: LyricsResult): void {
    if (result.status === 'error') return // never cache failures
    const entry = { at: Date.now(), result }
    this.memory.set(id, entry)
    try {
      this.disk().write(id, JSON.stringify(entry))
    } catch (e) {
      log.warn('cache write failed', e)
    }
  }

  async get(track: Track, force = false): Promise<LyricsResult> {
    if (track.id.startsWith('demo:')) return demoLyrics(track.id)
    // Podcasts / local files have no catalog lyrics.
    if (track.uri.startsWith('spotify:episode:') || track.uri.startsWith('spotify:local:'))
      return { trackId: track.id, status: 'none', provider: 'none', lines: [] }

    // A match the user picked manually always wins over automatic matching.
    const pin = this.pins().pins[track.id]
    if (pin) {
      const cached = this.readCache(track.id)
      if (cached && !force) return cached
      const pinned = await this.fetchPinned(track.id, pin)
      if (pinned) return pinned
    }

    if (!force) {
      const cached = this.readCache(track.id)
      if (cached) return cached
    }
    const pending = this.inflight.get(track.id)
    if (pending) return pending
    const p = this.lookup(track).finally(() => this.inflight.delete(track.id))
    this.inflight.set(track.id, p)
    return p
  }

  private pins(): { pins: Record<string, Pin> } {
    return (this.pinStore ??= platform().store<{ pins: Record<string, Pin> }>('lyrics-pins.json', { pins: {} })).get()
  }

  private async fetchPinned(trackId: string, pin: Pin): Promise<LyricsResult | null> {
    const provider = this.providers.find((p) => p.id === pin.provider)
    if (!provider?.byId) return null
    try {
      const r = await provider.byId(pin.id, AbortSignal.timeout(15_000))
      if (r.kind !== 'found') return null
      const result = { ...this.build(trackId, provider.id, r), pinned: true }
      this.writeCache(trackId, result)
      return result
    } catch (e) {
      log.warn('pinned lookup failed', (e as Error).message)
      return null
    }
  }

  private queryFor(track: Track): LyricsQuery {
    return { trackId: track.id, title: track.title, artist: track.artists[0] ?? '', album: track.album, durationMs: track.durationMs }
  }

  /** Ranked alternatives so the user can fix a wrong match. */
  async candidates(track: Track): Promise<{ items: Array<LyricsCandidate & { provider: string }>; error?: string }> {
    const items: Array<LyricsCandidate & { provider: string }> = []
    let error: string | undefined
    for (const p of this.providers) {
      if (!p.candidates) continue
      try {
        for (const c of await p.candidates(this.queryFor(track), AbortSignal.timeout(30_000))) items.push({ ...c, provider: p.id })
      } catch (e) {
        error = (e as Error).message
        log.warn(`${p.id} candidates failed`, error)
      }
    }
    return { items, error: items.length === 0 ? error : undefined }
  }

  /** Pin a specific provider entry to this track (remembered across restarts). */
  async choose(track: Track, provider: string, id: string): Promise<LyricsResult> {
    const store = (this.pinStore ??= platform().store<{ pins: Record<string, Pin> }>('lyrics-pins.json', { pins: {} }))
    store.set({ pins: { ...store.get().pins, [track.id]: { provider, id } } })
    const result = await this.fetchPinned(track.id, { provider, id })
    return result ?? { trackId: track.id, status: 'none', provider, lines: [] }
  }

  /** Forget a manual pick and go back to automatic matching. */
  async clearPin(track: Track): Promise<LyricsResult> {
    const store = (this.pinStore ??= platform().store<{ pins: Record<string, Pin> }>('lyrics-pins.json', { pins: {} }))
    const pins = { ...store.get().pins }
    delete pins[track.id]
    store.set({ pins })
    return this.get(track, true)
  }

  /**
   * Rate limits are normal for a free service: wait out the cooldown (the UI just keeps showing its
   * loading state) instead of surfacing an error. Only give up after a couple of patient retries.
   */
  private async fetchPatiently(provider: LyricsProvider, q: LyricsQuery) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await provider.fetch(q, AbortSignal.timeout(20_000))
      } catch (e) {
        const wait = e instanceof LyricsProviderError && e.kind === 'rate-limit' ? e.retryAfterSec : undefined
        if (wait === undefined || attempt >= 2 || wait > 45) throw e
        log.info(`${provider.id} rate limited; waiting ${wait}s (attempt ${attempt + 1})`)
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000))
      }
    }
  }

  private async lookup(track: Track): Promise<LyricsResult> {
    // Be a polite client: space out requests when skipping through tracks quickly.
    const wait = this.lastCall + 400 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastCall = Date.now()

    const q = this.queryFor(track)
    let firstError: LyricsProviderError | null = null
    let answered = false

    for (const provider of this.providers) {
      try {
        const r = await this.fetchPatiently(provider, q)
        answered = true
        if (r.kind !== 'found') continue
        const result = this.build(track.id, provider.id, r)
        this.writeCache(track.id, result)
        return result
      } catch (e) {
        firstError ??= e instanceof LyricsProviderError ? e : new LyricsProviderError((e as Error).message, 'unknown')
        log.warn(`${provider.id} failed`, (e as Error).message)
      }
    }
    if (!answered && firstError) {
      return {
        trackId: track.id,
        status: 'error',
        provider: this.providers[0]?.id ?? 'none',
        lines: [],
        error: { kind: firstError.kind, message: firstError.message, retryable: firstError.retryable }
      }
    }
    const none: LyricsResult = { trackId: track.id, status: 'none', provider: this.providers[0]?.id ?? 'none', lines: [] }
    this.writeCache(track.id, none)
    return none
  }

  private build(trackId: string, provider: string, r: Extract<Awaited<ReturnType<LyricsProvider['fetch']>>, { kind: 'found' }>): LyricsResult {
    if (r.instrumental) return { trackId, status: 'instrumental', provider, lines: [], matched: r.matched }
    const lines = r.synced ? parseLrc(r.synced) : []
    if (lines.length > 0) {
      return { trackId, status: 'synced', provider, lines, matched: r.matched, wordSynced: lines.some((l) => l.words && l.words.length > 1) }
    }
    const plain = r.plain ?? (r.synced ? stripLrc(r.synced) : '')
    if (plain.trim()) return { trackId, status: 'plain', provider, lines: [], plain: plain.trim(), matched: r.matched }
    return { trackId, status: 'none', provider, lines: [] }
  }
}

export const lyricsService = new LyricsService()
