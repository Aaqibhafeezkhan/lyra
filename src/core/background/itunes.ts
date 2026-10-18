import type { Track } from '@shared/types'
import { logger, platform, type Store } from '../platform'
import { cleanVideoTitle } from './rank'

const log = logger('itunes')

const HIT_TTL = 30 * 24 * 3600_000
const MISS_TTL = 7 * 24 * 3600_000
/** Apple preview clips are served from these hosts only; anything else is ignored. */
export const HOST_RE = /^https:\/\/[a-z0-9-]+\.itunes\.apple\.com\//i

interface Entry {
  at: number
  url: string | null
  title: string
  /** pixel width of the clip (640 = low quality, 1920 = HD) */
  width: number
}

const norm = (s: string): string =>
  cleanVideoTitle(s)
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

class ItunesService {
  private cache: Store<{ entries: Record<string, Entry> }> | null = null
  private inflight = new Map<string, Promise<Entry | null>>()
  private entries(): Record<string, Entry> {
    return (this.cache ??= platform().store<{ entries: Record<string, Entry> }>('itunes-cache.json', { entries: {} })).get().entries
  }

  /** Free, key-less. Returns a short official clip or null. Network failures are not cached. */
  async find(track: Track): Promise<{ url: string; title: string; width: number } | null> {
    const hit = this.entries()[track.id]
    if (hit && Date.now() - hit.at < (hit.url ? HIT_TTL : MISS_TTL)) return hit.url ? { url: hit.url, title: hit.title, width: hit.width ?? 1920 } : null
    let p = this.inflight.get(track.id)
    if (!p) {
      p = this.search(track).finally(() => this.inflight.delete(track.id))
      this.inflight.set(track.id, p)
    }
    const r = await p
    return r?.url ? { url: r.url, title: r.title, width: r.width } : null
  }

  private async search(track: Track): Promise<Entry | null> {
    const artist = track.artists[0] ?? ''
    let json: { results?: Array<{ trackName?: string; artistName?: string; previewUrl?: string; trackTimeMillis?: number }> }
    try {
      const q = new URLSearchParams({ term: `${artist} ${track.title}`, entity: 'musicVideo', limit: '8' })
      const res = await platform().fetch(`https://itunes.apple.com/search?${q}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return null
      json = (await res.json()) as typeof json
    } catch (e) {
      log.warn('search failed', (e as Error).message)
      return null
    }
    const wantT = norm(track.title)
    const wantA = norm(artist)
    const widthOf = (u: string): number => {
      const m = /\.(\d{3,4})w\./.exec(u) ?? /\.(\d{3,4})x\d{3,4}\./.exec(u)
      return m ? Number(m[1]) : 640
    }
    const matches = (json.results ?? []).filter((r) => {
      if (!r.previewUrl || !HOST_RE.test(r.previewUrl)) return false
      const a = norm(r.artistName ?? '')
      // Apple sometimes lists videos as "Artist - Title"
      let t = norm(r.trackName ?? '')
      if (a && t.startsWith(a + ' ') && t !== wantT) t = t.slice(a.length).trim()
      return !!wantT && (t === wantT || t.startsWith(wantT) || wantT.startsWith(t)) && !!wantA && (a.includes(wantA) || wantA.includes(a))
    })
    const best = matches.sort((x, y) => widthOf(y.previewUrl!) - widthOf(x.previewUrl!))[0]
    const entry: Entry = { at: Date.now(), url: best?.previewUrl ?? null, title: best ? `${best.trackName} — ${best.artistName}` : '', width: best ? widthOf(best.previewUrl!) : 0 }
    const entries = this.entries()
    entries[track.id] = entry
    this.cache!.set({ entries })
    return entry
  }
}

export const itunes = new ItunesService()
export const itunesNorm = norm
