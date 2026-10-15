import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLrc, stripLrc } from '@shared/lrc'
import type { LyricsResult, Track } from '@shared/types'
import { createLogger } from '../logger'
import { demoLyrics } from '../demo/lyrics'
import { LrcLibProvider } from './lrclib'
import { LyricsProviderError, type LyricsProvider, type LyricsQuery } from './provider'

const log = createLogger('lyrics')

const FOUND_TTL = 30 * 24 * 3600_000
const NONE_TTL = 12 * 3600_000
const MAX_DISK_ENTRIES = 600

interface CacheEntry {
  at: number
  result: LyricsResult
}

class LyricsService {
  private readonly providers: LyricsProvider[] = [new LrcLibProvider()]
  private readonly memory = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<LyricsResult>>()
  private dir: string | null = null
  private lastCall = 0

  private cacheDir(): string {
    if (!this.dir) {
      this.dir = join(app.getPath('userData'), 'lyrics-cache')
      mkdirSync(this.dir, { recursive: true })
      this.prune()
    }
    return this.dir
  }

  private fileFor(id: string): string {
    return join(this.cacheDir(), createHash('sha1').update(id).digest('hex') + '.json')
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
      return JSON.parse(readFileSync(this.fileFor(id), 'utf8')) as CacheEntry
    } catch {
      return null
    }
  }

  private writeCache(id: string, result: LyricsResult): void {
    if (result.status === 'error') return // never cache failures
    const entry = { at: Date.now(), result }
    this.memory.set(id, entry)
    try {
      writeFileSync(this.fileFor(id), JSON.stringify(entry))
    } catch (e) {
      log.warn('cache write failed', e)
    }
  }

  private prune(): void {
    try {
      const files = readdirSync(this.dir!)
        .map((f) => ({ f, t: statSync(join(this.dir!, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      files.slice(MAX_DISK_ENTRIES).forEach(({ f }) => rmSync(join(this.dir!, f), { force: true }))
    } catch {
      /* best effort */
    }
  }

  async get(track: Track, force = false): Promise<LyricsResult> {
    if (track.id.startsWith('demo:')) return demoLyrics(track.id)
    // Podcasts / local files have no catalog lyrics.
    if (track.uri.startsWith('spotify:episode:') || track.uri.startsWith('spotify:local:'))
      return { trackId: track.id, status: 'none', provider: 'none', lines: [] }

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

  private async lookup(track: Track): Promise<LyricsResult> {
    // Be a polite client: space out requests when skipping through tracks quickly.
    const wait = this.lastCall + 400 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastCall = Date.now()

    const q: LyricsQuery = {
      trackId: track.id,
      title: track.title,
      artist: track.artists[0] ?? '',
      album: track.album,
      durationMs: track.durationMs
    }
    let firstError: LyricsProviderError | null = null
    let answered = false

    for (const provider of this.providers) {
      try {
        const r = await provider.fetch(q, AbortSignal.timeout(15_000))
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
