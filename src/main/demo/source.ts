import type { CommandResult, PlaybackSnapshot, PlayerCommand, QueueItem, RecentItem } from '@shared/types'
import { PlaybackSource } from '../source'
import { DEMO_TRACKS } from './data'

/** Offline playback simulator so the whole UI is usable without Spotify credentials. */
export class DemoSource extends PlaybackSource {
  readonly kind = 'demo' as const
  private index = 0
  private playing = true
  private basePos = 0
  private baseAt = Date.now()
  private volume = 70
  private shuffle = false
  private repeat: 'off' | 'track' | 'context' = 'off'
  private endTimer: NodeJS.Timeout | null = null
  private liked = new Set<string>()

  start(): void {
    this.setStatus({ state: 'demo', message: 'Demo mode — simulated playback' })
    this.publish()
  }

  stop(): void {
    if (this.endTimer) clearTimeout(this.endTimer)
    this.endTimer = null
  }

  private position(): number {
    const t = DEMO_TRACKS[this.index]!
    return Math.min(t.durationMs, this.basePos + (this.playing ? Date.now() - this.baseAt : 0))
  }

  private publish(): void {
    const track = DEMO_TRACKS[this.index]!
    const snap: PlaybackSnapshot = {
      track,
      isPlaying: this.playing,
      positionMs: this.position(),
      sampledAt: Date.now(),
      device: { id: 'demo', name: 'Demo device', type: 'Computer', volumePercent: this.volume, supportsVolume: true },
      shuffle: this.shuffle,
      repeat: this.repeat,
      isAdOrUnknown: false
    }
    this.setSnapshot(snap)
    if (this.endTimer) clearTimeout(this.endTimer)
    this.endTimer = this.playing
      ? setTimeout(() => this.advance(1, true), Math.max(200, track.durationMs - snap.positionMs))
      : null
  }

  private jump(i: number): void {
    this.index = (i + DEMO_TRACKS.length) % DEMO_TRACKS.length
    this.basePos = 0
    this.baseAt = Date.now()
    this.publish()
  }

  private advance(dir: 1 | -1, auto = false): void {
    if (auto && this.repeat === 'track') return this.jump(this.index)
    if (dir === -1 && this.position() > 3000) return this.jump(this.index) // restart like real players
    this.jump(this.shuffle && dir === 1 ? Math.floor(Math.random() * DEMO_TRACKS.length) : this.index + dir)
  }

  async command(cmd: PlayerCommand): Promise<CommandResult> {
    switch (cmd.type) {
      case 'play':
      case 'pause':
      case 'toggle': {
        const want = cmd.type === 'toggle' ? !this.playing : cmd.type === 'play'
        if (want !== this.playing) {
          this.basePos = this.position()
          this.baseAt = Date.now()
          this.playing = want
        }
        break
      }
      case 'next':
        return this.advance(1), { ok: true }
      case 'previous':
        return this.advance(-1), { ok: true }
      case 'seek':
        this.basePos = Math.max(0, Math.min(cmd.positionMs, DEMO_TRACKS[this.index]!.durationMs - 100))
        this.baseAt = Date.now()
        break
      case 'volume':
        this.volume = Math.round(cmd.percent)
        break
      case 'shuffle':
        this.shuffle = cmd.on
        break
      case 'repeat':
        this.repeat = cmd.mode
        break
    }
    this.publish()
    return { ok: true }
  }

  async isLiked(id: string): Promise<boolean | null> {
    return this.liked.has(id)
  }

  async setLiked(id: string, liked: boolean): Promise<CommandResult> {
    if (liked) this.liked.add(id)
    else this.liked.delete(id)
    return { ok: true }
  }

  async queue(): Promise<QueueItem[] | null> {
    return DEMO_TRACKS.map((_, k) => DEMO_TRACKS[(this.index + 1 + k) % DEMO_TRACKS.length]!)
      .filter((t) => t.id !== DEMO_TRACKS[this.index]!.id)
      .map((t) => ({ id: t.id, title: t.title, artists: t.artists, artworkUrl: t.artworkUrl }))
  }

  async recent(): Promise<RecentItem[] | null> {
    return DEMO_TRACKS.slice(0, this.index).reverse().map((t, i) => ({
      id: t.id,
      title: t.title,
      artists: t.artists,
      artworkUrl: t.artworkUrl,
      playedAt: new Date(Date.now() - (i + 1) * 240_000).toISOString()
    }))
  }
}
