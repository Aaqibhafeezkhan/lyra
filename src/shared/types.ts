// Types shared by main, preload and renderer. No runtime imports allowed here.

export type ViewMode = 'minimal' | 'compact' | 'mini' | 'full'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Sent when the window mode changes. When `from`/`to` are present the window has already been grown to
 * cover both rectangles and the renderer must animate its shell between them (coordinates are relative
 * to the window), then call `window.settle()`.
 */
export interface ModeEvent {
  mode: ViewMode
  from?: Rect
  to?: Rect
}

export interface Track {
  /** Stable id: Spotify track id, or `demo:<n>` in demo mode. */
  id: string
  uri: string
  title: string
  artists: string[]
  album: string
  releaseYear: number | null
  durationMs: number
  artworkUrl: string | null
  explicit: boolean
  /** https URL that opens the track in Spotify (null for demo). */
  webUrl: string | null
}

export interface PlaybackDevice {
  id: string | null
  name: string
  type: string
  volumePercent: number | null
  supportsVolume: boolean
}

export interface PlaybackSnapshot {
  track: Track | null
  isPlaying: boolean
  /** Position at `sampledAt`. Renderer interpolates while playing. */
  positionMs: number
  /** Date.now() on the main process when position was sampled (corrected for request latency). */
  sampledAt: number
  device: PlaybackDevice | null
  shuffle: boolean
  repeat: 'off' | 'track' | 'context'
  /** True when Spotify reports an ad / non-music item. */
  isAdOrUnknown: boolean
}

export type ConnectionState =
  | 'needs-setup' // no client id configured
  | 'disconnected' // client id set, not signed in
  | 'connecting' // browser auth in flight
  | 'connected'
  | 'offline' // signed in but network/API unreachable
  | 'demo'
  | 'local' // Windows media controls (no account needed)

export interface ConnectionStatus {
  state: ConnectionState
  message?: string
  /** Seconds until the next retry when rate-limited. */
  retryInSec?: number
  userName?: string
  product?: string // 'premium' | 'free' | 'open'
  /** Account can't use remote playback control (non-premium). */
  controlsLimited?: boolean
}

export interface QueueItem {
  id: string
  title: string
  artists: string[]
  artworkUrl: string | null
}

export interface RecentItem extends QueueItem {
  playedAt: string
}

export type PlayerCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; percent: number }
  | { type: 'shuffle'; on: boolean }
  | { type: 'repeat'; mode: 'off' | 'track' | 'context' }

export interface CommandResult {
  ok: boolean
  /** Human-readable reason when !ok. */
  error?: string
  /** Machine hint so UI can show the right explanation. */
  reason?: 'premium-required' | 'no-device' | 'rate-limited' | 'offline' | 'unauthorized' | 'unsupported' | 'unknown'
}

// ---------- Lyrics ----------

export interface LyricWord {
  timeMs: number
  text: string
}

export interface LyricLine {
  timeMs: number
  text: string
  /** Only present when the source supplied word-level timing. */
  words?: LyricWord[]
}

export type LyricsStatus = 'synced' | 'plain' | 'instrumental' | 'none' | 'error'

export interface LyricsCandidateInfo {
  provider: string
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
  synced: boolean
  instrumental: boolean
}

export interface LyricsResult {
  trackId: string
  status: LyricsStatus
  provider: string
  lines: LyricLine[]
  plain?: string
  wordSynced?: boolean
  /** True when the user manually picked this match. */
  pinned?: boolean
  /** What the provider matched, so the UI can reveal wrong matches. */
  matched?: { title: string; artist: string; durationMs: number }
  error?: { kind: 'network' | 'rate-limit' | 'server' | 'unknown'; message: string; retryable: boolean }
}

// ---------- Settings ----------

export type ThemeMode = 'dark' | 'light' | 'adaptive'
export type LyricFont = 'sans' | 'serif' | 'rounded' | 'mono'
export type LyricAnimation = 'glide' | 'focus' | 'fade'

export type SourceKind = 'local' | 'api'

export interface Settings {
  /** Where playback info comes from: Windows media controls (default, no account) or Spotify Web API. */
  source: SourceKind
  defaultMode: Exclude<ViewMode, 'full'>
  opacity: number // 0.4 - 1
  alwaysOnTop: boolean
  autoHide: boolean
  hideOnScreenShare: boolean
  launchAtStartup: boolean
  globalShortcuts: boolean
  /** User overrides for global shortcuts: id -> Electron accelerator. */
  shortcuts: Record<string, string>
  /** First-run welcome has been dismissed. */
  onboarded: boolean
  /** Windows source only: control the system volume (loads a helper some antivirus tools flag). */
  systemVolume: boolean
  trackNotifications: boolean
  theme: ThemeMode
  lyricFont: LyricFont
  lyricFontSize: number // px, fullscreen base
  lineSpacing: number // 1 - 2
  lyricAnimation: LyricAnimation
  lyricOffsetMs: number
  reducedMotion: 'system' | 'on' | 'off'
  compactWidth: number
  /** User-resized size of the expanded player (null = automatic). */
  miniSize: { width: number; height: number } | null
  position: { x: number; y: number } | null
  spotifyClientId: string
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'local',
  defaultMode: 'compact',
  opacity: 0.94,
  alwaysOnTop: true,
  autoHide: false,
  hideOnScreenShare: false,
  launchAtStartup: false,
  globalShortcuts: true,
  shortcuts: {},
  onboarded: false,
  systemVolume: false,
  trackNotifications: false,
  theme: 'adaptive',
  lyricFont: 'sans',
  lyricFontSize: 40,
  lineSpacing: 1.35,
  lyricAnimation: 'glide',
  lyricOffsetMs: 0,
  reducedMotion: 'system',
  compactWidth: 380,
  miniSize: null,
  position: null,
  spotifyClientId: ''
}

export interface SavedMoment {
  id: string
  trackId: string
  title: string
  artist: string
  artworkUrl: string | null
  text: string
  timeMs: number
  savedAt: number
}

export type AppCommand =
  | 'toggle-play'
  | 'next'
  | 'previous'
  | 'toggle-expand'
  | 'toggle-fullscreen'
  | 'open-settings'
