import type {
  CommandResult,
  PlaybackSnapshot,
  PlayerCommand,
  QueueItem,
  RecentItem,
  Track
} from '@shared/types'
import { createLogger } from '../logger'
import { PlaybackSource } from '../source'
import { ApiError, NetworkError, SpotifyApi } from './api'
import { AuthError, SpotifyAuth } from './auth'

const log = createLogger('spotify')

interface SpImage {
  url: string
  width?: number | null
}
interface SpItem {
  id: string | null
  uri: string
  name: string
  type: 'track' | 'episode' | string
  duration_ms: number
  explicit?: boolean
  is_local?: boolean
  artists?: Array<{ name: string }>
  album?: { name: string; release_date?: string; images?: SpImage[] }
  show?: { name: string; publisher?: string; images?: SpImage[] }
  images?: SpImage[]
  external_urls?: { spotify?: string }
}
interface SpPlayer {
  device?: { id: string | null; name: string; type: string; volume_percent: number | null; supports_volume?: boolean }
  repeat_state?: 'off' | 'track' | 'context'
  shuffle_state?: boolean
  progress_ms?: number | null
  is_playing?: boolean
  item?: SpItem | null
  currently_playing_type?: string
}

const biggest = (imgs?: SpImage[]): string | null =>
  imgs && imgs.length ? [...imgs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]!.url : null

export function mapTrack(i: SpItem): Track {
  const isEpisode = i.type === 'episode'
  return {
    id: i.id ?? i.uri,
    uri: i.uri,
    title: i.name,
    artists: isEpisode ? [i.show?.name ?? i.show?.publisher ?? 'Podcast'] : (i.artists ?? []).map((a) => a.name),
    album: isEpisode ? (i.show?.name ?? '') : (i.album?.name ?? ''),
    releaseYear: i.album?.release_date ? Number(i.album.release_date.slice(0, 4)) || null : null,
    durationMs: i.duration_ms,
    artworkUrl: biggest(i.album?.images) ?? biggest(i.images) ?? biggest(i.show?.images),
    explicit: !!i.explicit,
    webUrl: i.external_urls?.spotify ?? null
  }
}

const IDLE: Omit<PlaybackSnapshot, 'sampledAt'> = {
  track: null,
  isPlaying: false,
  positionMs: 0,
  device: null,
  shuffle: false,
  repeat: 'off',
  isAdOrUnknown: false
}

export class SpotifySource extends PlaybackSource {
  readonly kind = 'spotify' as const
  private timer: NodeJS.Timeout | null = null
  private running = false
  private background = false
  private failures = 0
  private lastEmitted: PlaybackSnapshot | null = null
  private liked = new Map<string, boolean>()
  private inflight = false

  readonly api: SpotifyApi

  constructor(
    private readonly auth: SpotifyAuth,
    private readonly getClientId: () => string
  ) {
    super()
    this.api = new SpotifyApi(auth, getClientId)
  }

  // ---- lifecycle ----

  start(): void {
    const id = this.getClientId()
    if (!id) return this.setStatus({ state: 'needs-setup' })
    if (!this.auth.isSignedIn(id)) return this.setStatus({ state: 'disconnected' })
    this.begin()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async connect(): Promise<void> {
    const id = this.getClientId()
    if (!id) return this.setStatus({ state: 'needs-setup' })
    this.setStatus({ state: 'connecting', message: 'Approve access in your browser…' })
    try {
      await this.auth.authorize(id)
      this.begin()
    } catch (e) {
      const msg = e instanceof AuthError ? e.message : (e as Error).message
      log.warn('connect failed', msg)
      if (e instanceof AuthError && e.message === 'Sign-in cancelled.') return // user backed out; status already reset
      this.setStatus({ state: 'disconnected', message: msg })
    }
  }

  disconnect(): void {
    this.stop()
    this.auth.signOut()
    this.liked.clear()
    this.lastEmitted = null
    this.snapshot = null
    this.setStatus({ state: 'disconnected' })
  }

  setBackground(hidden: boolean): void {
    this.background = hidden
  }

  private begin(): void {
    this.running = true
    this.failures = 0
    this.setStatus({ state: 'connected' })
    void this.loadProfile()
    this.schedule(0)
  }

  private async loadProfile(): Promise<void> {
    try {
      const r = await this.api.request<{ display_name?: string; product?: string }>('GET', '/me')
      this.setStatus({
        ...this.status,
        userName: r.data?.display_name,
        product: r.data?.product,
        controlsLimited: !!r.data?.product && r.data.product !== 'premium'
      })
    } catch (e) {
      log.warn('profile fetch failed', (e as Error).message)
    }
  }

  // ---- polling ----

  private schedule(ms: number): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.poll(), ms)
  }

  private nextDelay(): number {
    const s = this.snapshot
    if (!s || !s.track) return this.background ? 15_000 : 5_000
    if (!s.isPlaying) return this.background ? 12_000 : 6_000
    const base = this.background ? 8_000 : 3_000
    const remaining = s.track.durationMs - (s.positionMs + (Date.now() - s.sampledAt))
    // wake right after the track ends so we notice the next one quickly
    return remaining > 0 ? Math.max(500, Math.min(base, remaining + 400)) : base
  }

  private async poll(): Promise<void> {
    if (!this.running || this.inflight) return
    this.inflight = true
    const t0 = Date.now()
    try {
      const r = await this.api.request<SpPlayer>('GET', '/me/player?additional_types=episode')
      const t1 = Date.now()
      this.failures = 0
      if (this.status.state !== 'connected') this.setStatus({ ...this.status, state: 'connected', message: undefined, retryInSec: undefined })
      this.ingest(r.data, Math.round((t0 + t1) / 2))
      this.schedule(this.nextDelay())
    } catch (e) {
      this.handlePollError(e)
    } finally {
      this.inflight = false
    }
  }

  private handlePollError(e: unknown): void {
    if (e instanceof AuthError) {
      this.stop()
      this.setStatus({ state: 'disconnected', message: 'Your Spotify session expired. Please sign in again.' })
      return
    }
    if (e instanceof ApiError && e.status === 429) {
      const wait = e.retryAfterSec ?? 10
      this.setStatus({ ...this.status, state: 'offline', message: 'Spotify is rate limiting requests. Retrying shortly.', retryInSec: wait })
      this.schedule(wait * 1000 + 500)
      return
    }
    this.failures++
    const backoff = Math.min(30_000, 2_000 * 2 ** Math.min(this.failures, 4))
    if (e instanceof NetworkError) {
      this.setStatus({ ...this.status, state: 'offline', message: 'Can’t reach Spotify. Check your connection.', retryInSec: Math.round(backoff / 1000) })
    } else if (e instanceof ApiError && e.status === 403) {
      this.setStatus({
        ...this.status,
        state: 'offline',
        message: `Spotify denied access (403): “${e.message}”. In Development Mode the signed-in Spotify account must be listed under User Management (with the exact email of that Spotify account), and the app owner may need an active Premium subscription.`
      })
    } else {
      this.setStatus({ ...this.status, state: 'offline', message: (e as Error).message, retryInSec: Math.round(backoff / 1000) })
    }
    log.warn('poll failed', (e as Error).message)
    this.schedule(backoff)
  }

  private ingest(p: SpPlayer | null, sampledAt: number): void {
    const item = p?.item ?? null
    const snap: PlaybackSnapshot =
      !p || !item
        ? { ...IDLE, sampledAt, isPlaying: !!p?.is_playing, isAdOrUnknown: !!p && p.currently_playing_type === 'ad', device: p?.device ? mapDevice(p.device) : null }
        : {
            track: mapTrack(item),
            isPlaying: !!p.is_playing,
            positionMs: p.progress_ms ?? 0,
            sampledAt,
            device: p.device ? mapDevice(p.device) : null,
            shuffle: !!p.shuffle_state,
            repeat: p.repeat_state ?? 'off',
            isAdOrUnknown: false
          }
    this.snapshot = snap
    if (this.shouldEmit(snap)) {
      this.lastEmitted = snap
      this.emit('snapshot', snap)
    }
  }

  private shouldEmit(n: PlaybackSnapshot): boolean {
    const o = this.lastEmitted
    if (!o) return true
    if (o.track?.id !== n.track?.id || o.isPlaying !== n.isPlaying || o.shuffle !== n.shuffle || o.repeat !== n.repeat) return true
    if (o.isAdOrUnknown !== n.isAdOrUnknown) return true
    if (o.device?.name !== n.device?.name || o.device?.volumePercent !== n.device?.volumePercent) return true
    const predicted = o.positionMs + (o.isPlaying ? n.sampledAt - o.sampledAt : 0)
    return Math.abs(predicted - n.positionMs) > 1200 // seek or drift
  }

  /** Force a fresh poll shortly after a command so the UI reflects the real state. */
  private pollSoon(ms = 350): void {
    this.schedule(ms)
  }

  // ---- commands ----

  async command(cmd: PlayerCommand): Promise<CommandResult> {
    try {
      switch (cmd.type) {
        case 'play':
          await this.api.request('PUT', '/me/player/play')
          break
        case 'pause':
          await this.api.request('PUT', '/me/player/pause')
          break
        case 'toggle':
          return this.command({ type: this.snapshot?.isPlaying ? 'pause' : 'play' })
        case 'next':
          await this.api.request('POST', '/me/player/next')
          break
        case 'previous':
          await this.api.request('POST', '/me/player/previous')
          break
        case 'seek':
          await this.api.request('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(cmd.positionMs))}`)
          break
        case 'volume':
          if (this.snapshot?.device && !this.snapshot.device.supportsVolume)
            return { ok: false, reason: 'unsupported', error: `${this.snapshot.device.name} doesn’t allow volume control from here.` }
          await this.api.request('PUT', `/me/player/volume?volume_percent=${Math.min(100, Math.max(0, Math.round(cmd.percent)))}`)
          break
        case 'shuffle':
          await this.api.request('PUT', `/me/player/shuffle?state=${cmd.on}`)
          break
        case 'repeat':
          await this.api.request('PUT', `/me/player/repeat?state=${cmd.mode}`)
          break
      }
      this.pollSoon(cmd.type === 'volume' || cmd.type === 'seek' ? 900 : 350)
      return { ok: true }
    } catch (e) {
      return mapCommandError(e)
    }
  }

  async isLiked(trackId: string): Promise<boolean | null> {
    if (trackId.includes(':')) return null // local files / episodes
    const cached = this.liked.get(trackId)
    if (cached !== undefined) return cached
    try {
      const r = await this.api.request<boolean[]>('GET', `/me/tracks/contains?ids=${encodeURIComponent(trackId)}`)
      const v = !!r.data?.[0]
      this.liked.set(trackId, v)
      return v
    } catch (e) {
      log.warn('isLiked failed', (e as Error).message)
      return null
    }
  }

  async setLiked(trackId: string, liked: boolean): Promise<CommandResult> {
    try {
      await this.api.request(liked ? 'PUT' : 'DELETE', `/me/tracks?ids=${encodeURIComponent(trackId)}`)
      this.liked.set(trackId, liked)
      return { ok: true }
    } catch (e) {
      return mapCommandError(e)
    }
  }

  async queue(): Promise<QueueItem[] | null> {
    try {
      const r = await this.api.request<{ queue?: SpItem[] }>('GET', '/me/player/queue')
      return (r.data?.queue ?? []).slice(0, 20).map((i) => {
        const t = mapTrack(i)
        return { id: t.id, title: t.title, artists: t.artists, artworkUrl: t.artworkUrl }
      })
    } catch (e) {
      log.warn('queue failed', (e as Error).message)
      return null
    }
  }

  async recent(): Promise<RecentItem[] | null> {
    try {
      const r = await this.api.request<{ items?: Array<{ track: SpItem; played_at: string }> }>('GET', '/me/player/recently-played?limit=20')
      return (r.data?.items ?? []).map((x) => {
        const t = mapTrack(x.track)
        return { id: t.id, title: t.title, artists: t.artists, artworkUrl: t.artworkUrl, playedAt: x.played_at }
      })
    } catch (e) {
      log.warn('recent failed', (e as Error).message)
      return null
    }
  }
}

function mapDevice(d: NonNullable<SpPlayer['device']>) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    volumePercent: d.volume_percent,
    // Spotify omits the flag on some SDKs; only treat explicit false (or null volume) as unsupported
    supportsVolume: d.supports_volume !== false && d.volume_percent !== null
  }
}

function mapCommandError(e: unknown): CommandResult {
  if (e instanceof AuthError) return { ok: false, reason: 'unauthorized', error: 'Spotify session expired. Sign in again.' }
  if (e instanceof NetworkError) return { ok: false, reason: 'offline', error: 'Can’t reach Spotify.' }
  if (e instanceof ApiError) {
    if (e.status === 429) return { ok: false, reason: 'rate-limited', error: 'Spotify is rate limiting — try again in a moment.' }
    if (e.reason === 'PREMIUM_REQUIRED')
      return { ok: false, reason: 'premium-required', error: 'Spotify only allows remote playback control on Premium accounts. Use the Spotify app to control playback.' }
    if (e.reason === 'NO_ACTIVE_DEVICE' || e.status === 404)
      return { ok: false, reason: 'no-device', error: 'No active Spotify device. Start playback in the Spotify app first.' }
    if (e.status === 403) return { ok: false, reason: 'unsupported', error: e.message || 'Spotify doesn’t allow that action right now.' }
    return { ok: false, reason: 'unknown', error: e.message }
  }
  return { ok: false, reason: 'unknown', error: (e as Error).message }
}
