import type { Track, YoutubeVideo } from '@shared/types'
import { logger, platform, type Store } from '../platform'
import { parseIsoDuration, rankKaraoke, rankVideos, type VideoCandidate } from './rank'

const log = logger('youtube')

const API = 'https://www.googleapis.com/youtube/v3'
const MISS_TTL = 14 * 24 * 3600_000
const QUOTA_COOLDOWN = 6 * 3600_000

interface Entry {
  at: number
  /** the auto-play pick (null = nothing convincing found) */
  video: YoutubeVideo | null
  /** everything we found, so the picker panel costs no extra quota */
  list: YoutubeVideo[]
}

export type YoutubeResult =
  | { state: 'found'; video: YoutubeVideo; list: YoutubeVideo[] }
  | { state: 'none'; list: YoutubeVideo[] }
  | { state: 'no-key' }
  | { state: 'error'; message: string }

/** The YouTube API returns HTML-escaped text (&amp; &quot; &#39;). */
function decodeEntities(t: string): string {
  return t
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

class YoutubeService {
  private readonly karaokeCache = new Map<string, { at: number; items: YoutubeVideo[] }>()
  private cache: Store<{ entries: Record<string, Entry> }> | null = null
  private cooldownUntil = 0
  private key: string | null | undefined // undefined = not loaded yet
  private inflight = new Map<string, Promise<YoutubeResult>>()

  private entries(): Record<string, Entry> {
    return (this.cache ??= platform().store<{ entries: Record<string, Entry> }>('youtube-cache-v2.json', { entries: {} })).get().entries
  }

  /** The key is encrypted by the host (never sent to the interface). */
  private loadKey(): string | null {
    if (this.key !== undefined) return this.key
    try {
      this.key = platform().secret('youtube-key').load()
    } catch {
      this.key = null
    }
    return this.key
  }
  hasKey(): boolean {
    return !!this.loadKey()
  }

  async setKey(raw: string): Promise<{ ok: boolean; error?: string }> {
    const key = raw.trim()
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(key)) return { ok: false, error: 'That doesn’t look like a YouTube API key (letters, numbers, - and _ only).' }
    const secret = platform().secret('youtube-key')
    if (!secret.available()) return { ok: false, error: 'Secure storage isn’t available on this device, so the key can’t be saved safely.' }
    // cheapest possible call (1 quota unit) to prove the key works
    const probe = await this.call('videos', { part: 'id', id: 'dQw4w9WgXcQ' }, key)
    if (!probe.ok) return { ok: false, error: probe.message }
    secret.save(key)
    this.key = key
    this.cooldownUntil = 0
    return { ok: true }
  }
  clearKey(): void {
    platform().secret('youtube-key').clear()
    this.key = null
  }

  private async call(path: string, params: Record<string, string>, key: string): Promise<{ ok: true; json: any } | { ok: false; message: string; quota?: boolean }> {
    const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`
    let res: Response
    try {
      res = await platform().fetch(url, { signal: AbortSignal.timeout(12_000) })
    } catch (e) {
      return { ok: false, message: `Couldn’t reach YouTube: ${(e as Error).message}` }
    }
    if (res.ok) return { ok: true, json: await res.json() }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    const reason = body.error?.errors?.[0]?.reason ?? ''
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return { ok: false, quota: true, message: 'Your YouTube API daily quota is used up. Lyra will try again later.' }
    if (reason === 'keyInvalid' || res.status === 400) return { ok: false, message: 'YouTube rejected this API key. Check that “YouTube Data API v3” is enabled for it.' }
    if (reason === 'accessNotConfigured' || res.status === 403) return { ok: false, message: 'This key can’t use the YouTube Data API v3. Enable it in Google Cloud Console.' }
    return { ok: false, message: body.error?.message?.slice(0, 140) ?? `YouTube error ${res.status}` }
  }

  /** Find the official video for a track (cached; one search = 100 quota units, so we search once per song). */
  find(track: Track): Promise<YoutubeResult> {
    const key = this.loadKey()
    if (!key) return Promise.resolve({ state: 'no-key' })
    const hit = this.entries()[track.id]
    if (hit && (hit.video || Date.now() - hit.at < MISS_TTL)) {
      return Promise.resolve(hit.video ? { state: 'found', video: hit.video, list: hit.list } : { state: 'none', list: hit.list })
    }
    if (Date.now() < this.cooldownUntil) return Promise.resolve({ state: 'error', message: 'YouTube quota is used up for now; trying again later.' })
    const running = this.inflight.get(track.id)
    if (running) return running
    const p = this.search(track, key).finally(() => this.inflight.delete(track.id))
    this.inflight.set(track.id, p)
    return p
  }

  private async search(track: Track, key: string): Promise<YoutubeResult> {
    const artist = track.artists[0] ?? ''
    const s = await this.call(
      'search',
      { part: 'snippet', type: 'video', videoEmbeddable: 'true', videoCategoryId: '10', maxResults: '6', q: `${artist} ${track.title} official music video -lyrics` },
      key
    )
    if (!s.ok) {
      if (s.quota) this.cooldownUntil = Date.now() + QUOTA_COOLDOWN
      log.warn('search failed', s.message)
      return { state: 'error', message: s.message }
    }
    const items = (s.json.items ?? []) as Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>
    const ids = items.map((i) => i.id?.videoId).filter((x): x is string => !!x)
    if (ids.length === 0) return this.remember(track, null, [])

    const d = await this.call('videos', { part: 'contentDetails,status', id: ids.join(',') }, key)
    const details = new Map<string, { sec: number | null; embeddable: boolean }>()
    if (d.ok) {
      for (const v of (d.json.items ?? []) as Array<{ id: string; contentDetails?: { duration?: string }; status?: { embeddable?: boolean; privacyStatus?: string } }>) {
        details.set(v.id, { sec: parseIsoDuration(v.contentDetails?.duration), embeddable: !!v.status?.embeddable && v.status?.privacyStatus === 'public' })
      }
    }
    const candidates: VideoCandidate[] = items.flatMap((i) => {
      const id = i.id?.videoId
      if (!id) return []
      const info = details.get(id)
      return [{ videoId: id, title: decodeEntities(i.snippet?.title ?? ''), channel: decodeEntities(i.snippet?.channelTitle ?? ''), durationSec: info?.sec ?? null, embeddable: info ? info.embeddable : true }]
    })
    const ranked = rankVideos({ title: track.title, artist, durationMs: track.durationMs }, candidates)
    const list: YoutubeVideo[] = ranked.map((r) => ({ videoId: r.videoId, title: r.title, channel: r.channel, durationSec: r.durationSec }))
    const best = ranked.find((r) => r.acceptable)
    return this.remember(track, best ? list.find((l) => l.videoId === best.videoId)! : null, list)
  }

  private remember(track: Track, video: YoutubeVideo | null, list: YoutubeVideo[]): YoutubeResult {
    const entries = this.entries()
    entries[track.id] = { at: Date.now(), video, list }
    this.cache!.set({ entries })
    return video ? { state: 'found', video, list } : { state: 'none', list }
  }

  /** Karaoke / instrumental versions of a song to sing along to, best first (cached for a day). */
  async karaoke(track: Track): Promise<{ items: YoutubeVideo[]; error?: string }> {
    const key = this.loadKey()
    if (!key) return { items: [], error: 'Add a YouTube API key in Settings → Background first.' }
    const hit = this.karaokeCache.get(track.id)
    if (hit && Date.now() - hit.at < 24 * 3600_000) return { items: hit.items }
    if (Date.now() < this.cooldownUntil) return { items: [], error: 'YouTube quota is used up for now; trying again later.' }
    const artist = track.artists[0] ?? ''
    const s = await this.call('search', { part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q: `${track.title} ${artist} karaoke instrumental` }, key)
    if (!s.ok) {
      if (s.quota) this.cooldownUntil = Date.now() + QUOTA_COOLDOWN
      return { items: [], error: s.message }
    }
    const found = (s.json.items ?? []) as Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>
    const ids = found.map((i) => i.id?.videoId).filter((x): x is string => !!x)
    if (ids.length === 0) return { items: [] }
    const d = await this.call('videos', { part: 'contentDetails,status', id: ids.join(',') }, key)
    const details = new Map<string, { sec: number | null; embeddable: boolean }>()
    if (d.ok) {
      for (const v of (d.json.items ?? []) as Array<{ id: string; contentDetails?: { duration?: string }; status?: { embeddable?: boolean; privacyStatus?: string } }>) {
        details.set(v.id, { sec: parseIsoDuration(v.contentDetails?.duration), embeddable: !!v.status?.embeddable && v.status?.privacyStatus === 'public' })
      }
    }
    const candidates: VideoCandidate[] = found.flatMap((i) => {
      const id = i.id?.videoId
      if (!id) return []
      const info = details.get(id)
      return [{ videoId: id, title: decodeEntities(i.snippet?.title ?? ''), channel: decodeEntities(i.snippet?.channelTitle ?? ''), durationSec: info?.sec ?? null, embeddable: info ? info.embeddable : true }]
    })
    const ranked = rankKaraoke({ title: track.title, artist, durationMs: track.durationMs }, candidates)
    // acceptable ones first, then the rest by score (they appear in the "choose another" list)
    const items: YoutubeVideo[] = [...ranked.filter((r) => r.acceptable), ...ranked.filter((r) => !r.acceptable)].map((r) => ({ videoId: r.videoId, title: r.title, channel: r.channel, durationSec: r.durationSec }))
    this.karaokeCache.set(track.id, { at: Date.now(), items })
    return { items }
  }

  /** Candidates for the "wrong video?" picker (uses the cached search when there is one). */
  async candidates(track: Track): Promise<{ items: YoutubeVideo[]; error?: string }> {
    const r = await this.find(track)
    if (r.state === 'found' || r.state === 'none') return { items: r.list }
    if (r.state === 'no-key') return { items: [], error: 'Add a YouTube API key in Settings → Background first.' }
    return { items: [], error: r.message }
  }
}

export const youtube = new YoutubeService()
